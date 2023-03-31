use crate::{Command, EventType, Role, Subscriptions, SwarmLabel, SwarmProtocol};
use bitvec::{bitvec, vec::BitVec};
use itertools::Itertools;
use petgraph::{
    visit::{Dfs, DfsPostOrder, EdgeRef, GraphBase, Walker},
    Direction::{Incoming, Outgoing},
};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fmt,
    mem::take,
};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Error {
    InitialStateDisconnected,
    LogTypeEmpty(EdgeId),
    ActiveRoleNotSubscribed(EdgeId),
    LaterActiveRoleNotSubscribed(EdgeId, Role),
    LaterInvolvedRoleMoreSubscribed {
        edge: EdgeId,
        later: Role,
        active: Role,
        events: BTreeSet<EventType>,
    },
    LaterInvolvedNotGuarded(EdgeId, Role),
    NonDeterministicGuard(EdgeId),
    NonDeterministicCommand(EdgeId),
    GuardNotInvariant(EventType),
}

const INVALID_EDGE: &str = "[invalid EdgeId]";

impl Error {
    fn to_string(&self, graph: &Graph) -> String {
        match self {
            Error::InitialStateDisconnected => format!("initial state has no transitions"),
            Error::LogTypeEmpty(edge) => {
                format!("log type must not be empty {}", Edge(graph, *edge))
            }
            Error::ActiveRoleNotSubscribed(edge) => {
                format!("active role does not subscribe to any of its emitted event types in transition {}", Edge(graph, *edge))
            }
            Error::LaterActiveRoleNotSubscribed(edge, role) => {
                format!(
                    "subsequently active role {role} does not subscribe to events in transition {}",
                    Edge(graph, *edge)
                )
            }
            Error::LaterInvolvedRoleMoreSubscribed {
                edge,
                later,
                active,
                events,
            } => format!(
                "subsequently involved role {later} subscribes to more events \
                 than active role {active} in transition {}, namely ({})",
                Edge(graph, *edge),
                events.iter().join(", ")
            ),
            Error::LaterInvolvedNotGuarded(edge, role) => format!(
                "subsequently involved role {role} does not subscribe to guard \
                 in transition {}",
                Edge(graph, *edge)
            ),
            Error::NonDeterministicGuard(edge) => {
                let Some((state, _)) = graph.edge_endpoints(*edge) else {
                    return format!("non-deterministic event guard {}", INVALID_EDGE);
                };
                let state = &graph[state].name;
                let guard = &graph[*edge].log_type[0];
                format!("non-deterministic event guard type {guard} in state {state}")
            }
            Error::NonDeterministicCommand(edge) => {
                let Some((state, _)) = graph.edge_endpoints(*edge) else {
                    return format!("non-deterministic command {}", INVALID_EDGE);
                };
                let state = &graph[state].name;
                let command = &graph[*edge].cmd;
                let role = &graph[*edge].role;
                format!("non-deterministic command {command} for role {role} in state {state}")
            }
            Error::GuardNotInvariant(ev) => {
                format!("guard event type {ev} appears in transitions from multiple states")
            }
        }
    }
}

struct Edge<'a>(&'a Graph, EdgeId);

impl<'a> fmt::Display for Edge<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let Some((source, target)) = self.0.edge_endpoints(self.1) else {
            return f.write_str(INVALID_EDGE);
        };
        let source = &self.0[source].name;
        let target = &self.0[target].name;
        let label = &self.0[self.1];
        write!(f, "({source})--[{label}]-->({target})")
    }
}

#[derive(Debug)]
struct Node {
    name: String,
    active: BTreeSet<Role>,
    roles: BTreeSet<Role>,
}

impl Node {
    fn new(name: String) -> Self {
        Self {
            name,
            active: Default::default(),
            roles: Default::default(),
        }
    }
}

type Graph = petgraph::Graph<Node, SwarmLabel>;
pub type NodeId = <petgraph::Graph<(), ()> as GraphBase>::NodeId;
pub type EdgeId = <petgraph::Graph<(), ()> as GraphBase>::EdgeId;

pub fn check(proto: SwarmProtocol, subs: Subscriptions) -> Result<(), Vec<String>> {
    let (graph, initial, mut errors) = match prepare_graph(proto, &subs) {
        Ok((g, i)) => (g, i, Vec::new()),
        Err((g, Some(i), e)) => (g, i, e),
        Err((g, None, e)) => return Err(e.into_iter().map(|e| e.to_string(&g)).collect()),
    };
    errors.extend(well_formed(&graph, initial, subs));
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.into_iter().map(|e| e.to_string(&graph)).collect())
    }
}

fn well_formed(graph: &Graph, initial: NodeId, subs: Subscriptions) -> Vec<Error> {
    let mut errors = Vec::new();
    let empty = BTreeSet::new();
    let sub = |r: &Role| subs.get(&**r).unwrap_or(&empty);
    for node in Dfs::new(&graph, initial).iter(&graph) {
        let mut guards = BTreeMap::new();
        let mut commands = BTreeSet::new();
        for edge in graph.edges_directed(node, Outgoing) {
            let log = edge.weight().log_type.as_slice();

            // event determinism
            let guard = EventType::new(&log[0]);
            if *guards
                .entry(guard.clone())
                .and_modify(|count| *count += 1)
                .or_insert(1)
                == 2
            {
                errors.push(Error::NonDeterministicGuard(edge.id()));
            }
            // command determinism
            let command = Command::new(&edge.weight().cmd);
            let role = Role::new(&edge.weight().role);
            if !commands.insert((role.clone(), command.clone())) {
                errors.push(Error::NonDeterministicCommand(edge.id()));
            }

            let target = edge.target();

            // causal consistency
            if log_filter(log, sub(&role)).first_one().is_none() {
                errors.push(Error::ActiveRoleNotSubscribed(edge.id()));
            }
            for active in &graph[target].active {
                let filtered = log_filter(log, sub(active));
                if filtered.first_one().is_none() {
                    errors.push(Error::LaterActiveRoleNotSubscribed(
                        edge.id(),
                        active.clone(),
                    ));
                }
                for later in &graph[target].roles {
                    let later_log = log_filter(log, sub(later));
                    let extra = later_log & !filtered.clone();
                    if extra.first_one().is_some() {
                        errors.push(Error::LaterInvolvedRoleMoreSubscribed {
                            edge: edge.id(),
                            later: later.clone(),
                            active: active.clone(),
                            events: extra.iter_ones().map(|i| EventType::new(&log[i])).collect(),
                        });
                    }
                }
            }

            // choice determinacy
            let first_event = &log[0];
            for later in &graph[target].roles {
                if !sub(later).contains(first_event) {
                    errors.push(Error::LaterInvolvedNotGuarded(edge.id(), later.clone()));
                }
            }
        }
    }
    errors
}

fn prepare_graph(
    proto: SwarmProtocol,
    subs: &Subscriptions,
) -> Result<(Graph, NodeId), (Graph, Option<NodeId>, Vec<Error>)> {
    let mut errors = Vec::new();
    let mut graph = Graph::new();
    let mut nodes = HashMap::<String, NodeId>::new();
    for t in proto.transitions {
        tracing::debug!("adding {} --({:?})--> {}", t.source, t.label, t.target);
        let source = *nodes
            .entry(t.source.clone())
            .or_insert_with(|| graph.add_node(Node::new(t.source)));
        let target = *nodes
            .entry(t.target.clone())
            .or_insert_with(|| graph.add_node(Node::new(t.target)));
        let edge = graph.add_edge(source, target, t.label.clone());
        if t.label.log_type.len() == 0 {
            errors.push(Error::LogTypeEmpty(edge));
        }
        tracing::debug!("added {:?} --> {:?}", source, target);
    }
    let initial = if let Some(idx) = nodes.get(&proto.initial) {
        tracing::debug!("initial state {:?}", idx);
        *idx
    } else {
        errors.push(Error::InitialStateDisconnected);
        return Err((graph, None, errors));
    };
    let no_empty_logs = errors.is_empty();

    // compute the needed Node information
    // - first post-order walk to propagate non-loop roles back
    // - then keep fixing loop-ends until graph is stable
    let mut walk = DfsPostOrder::new(&graph, initial);
    let mut loop_end = HashSet::new();
    let mut guards = HashSet::new();
    let mut events = HashMap::new();
    while let Some(node_id) = walk.next(&graph) {
        let active = active(&graph, node_id);
        graph[node_id].active = active;
        let roles = involved(&graph, node_id, &subs, &mut loop_end);
        graph[node_id].roles = roles;
        mark_events(&graph, node_id, &mut guards, &mut events);
    }
    tracing::debug!("post-order traversal done, {} loop ends", loop_end.len());
    loop {
        let mut modified = false;
        for node_id in loop_end.iter().copied() {
            let mut roles = take(&mut graph[node_id].roles);
            let num_roles = roles.len();
            for edge in graph.edges_directed(node_id, Outgoing) {
                roles.extend(graph[edge.target()].roles.iter().cloned());
            }
            let changed = roles.len() > num_roles;
            graph[node_id].roles = roles;
            if changed {
                propagate_back(&mut graph, node_id);
                modified = true;
            }
        }
        if !modified {
            break;
        }
    }

    // confusion-freeness
    for guard in guards {
        if events[&guard].is_none() {
            errors.push(Error::GuardNotInvariant(guard));
        }
    }

    if errors.is_empty() {
        Ok((graph, initial))
    } else if no_empty_logs {
        Err((graph, Some(initial), errors))
    } else {
        Err((graph, None, errors))
    }
}

fn propagate_back(g: &mut Graph, node: NodeId) {
    let _span = tracing::debug_span!("propagate_back", node = g[node].name).entered();
    let mut queue = vec![node];
    rec(g, &mut queue);
    fn rec(g: &mut Graph, q: &mut Vec<NodeId>) {
        let Some(node_id) = q.pop() else { return };
        tracing::debug!("visiting {} ({} to go)", g[node_id].name, q.len());
        let target_roles = take(&mut g[node_id].roles);
        let mut walk = g.neighbors_directed(node_id, Incoming).detach();
        while let Some(source) = walk.next_node(g) {
            let source_roles = &mut g[source].roles;
            let num_roles = source_roles.len();
            source_roles.extend(target_roles.iter().cloned());
            let num_roles_now = source_roles.len();
            if num_roles_now > num_roles {
                tracing::debug!(
                    "{} roles grew {}->{}",
                    g[source].name,
                    num_roles,
                    num_roles_now
                );
                q.push(source);
            }
        }
        g[node_id].roles = target_roles;
        rec(g, q);
    }
}

/// compute a first approximation of Node::roles assuming to be called in DfsPostOrder
fn involved(
    g: &Graph,
    node: NodeId,
    subs: &Subscriptions,
    loop_end: &mut HashSet<NodeId>,
) -> BTreeSet<Role> {
    let _span = tracing::debug_span!("involved", node = g[node].name).entered();
    let mut roles = BTreeSet::new();
    for edge in g.edges_directed(node, Outgoing) {
        // first propagate back all roles from target state
        let target = edge.target();
        let target_roles = &g[target].roles;
        if target_roles.is_empty() {
            tracing::debug!("loop end towards {}", g[target].name);
            loop_end.insert(node);
        } else {
            tracing::debug!("propagating {:?} from {}", target_roles, g[target].name);
            roles.extend(target_roles.iter().cloned());
        }
        // then add roles involved in this transition
        for (role, types) in subs {
            let role = Role::new(role);
            if roles.contains(&role) {
                continue;
            }
            let interested = edge.weight().log_type.iter().any(|t| types.contains(t));
            if interested {
                tracing::debug!("{:?} is interested (towards {})", role, g[target].name);
                roles.insert(role);
            }
        }
    }
    roles
}

fn active(g: &Graph, node: NodeId) -> BTreeSet<Role> {
    let mut active = BTreeSet::new();
    let _span = tracing::debug_span!("active", node = g[node].name).entered();
    for x in g.edges_directed(node, Outgoing) {
        let role = &x.weight().role;
        tracing::debug!("found role {} (target {})", role, g[x.target()].name);
        active.insert(Role::new(role));
    }
    active
}

fn mark_events(
    g: &Graph,
    node: NodeId,
    guards: &mut HashSet<EventType>,
    events: &mut HashMap<EventType, Option<NodeId>>,
) {
    let _span = tracing::debug_span!("mark_events", node = g[node].name).entered();
    for edge in g.edges_directed(node, Outgoing) {
        let log = edge.weight().log_type.as_slice();
        if log.len() < 1 {
            continue;
        }
        guards.insert(EventType::new(&log[0]));
        for e in log {
            events
                .entry(EventType::new(&e))
                .and_modify(|n| {
                    if *n != Some(node) {
                        *n = None;
                    }
                })
                .or_insert(Some(node));
        }
    }
}

fn log_filter(log: &[String], subs: &BTreeSet<String>) -> BitVec {
    let mut ret = bitvec![0; log.len()];
    for (idx, event_type) in log.iter().enumerate() {
        if subs.contains(event_type) {
            ret.set(idx, true);
        }
    }
    ret
}

#[cfg(test)]
mod tests {
    use super::*;
    use maplit::btreeset;
    use petgraph::visit::{Dfs, Walker};
    use pretty_assertions::assert_eq;
    use std::collections::BTreeMap;
    use tracing_subscriber::{fmt, fmt::format::FmtSpan, EnvFilter};

    fn setup_logger() {
        fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .with_span_events(FmtSpan::ENTER | FmtSpan::CLOSE)
            .try_init()
            .ok();
    }
    fn r(s: &str) -> Role {
        Role::new(s)
    }
    fn e(g: &Graph, s: &str) -> EdgeId {
        g.edge_indices()
            .map(|id| (id, Edge(g, id).to_string()))
            .find(|x| &*x.1 == s)
            .unwrap()
            .0
    }
    fn ev(e: &str) -> EventType {
        EventType::new(e)
    }

    #[test]
    fn prep_cycles() {
        setup_logger();
        // (S0) --(C0@R1<R1>)--> (S1) --(C5@R6<R6>)--> (S4)
        // (S1) --(C1@R2<R2>)--> (S2) --(C2@R3<R3>)--> (S1)  [the first loop above S1]
        // (S2) --(C3@R4<R4>)--> (S3) --(C4@R5<R5>)--> (S2)  [the second loop atop the first]
        let proto = serde_json::from_str::<SwarmProtocol>(
            r#"{
                "initial": "S0",
                "transitions": [
                    { "source": "S0", "target": "S1", "label": { "cmd": "C0", "logType": ["R1"], "role": "R1" } },
                    { "source": "S1", "target": "S2", "label": { "cmd": "C1", "logType": ["R2"], "role": "R2" } },
                    { "source": "S2", "target": "S1", "label": { "cmd": "C2", "logType": ["R3"], "role": "R3" } },
                    { "source": "S2", "target": "S3", "label": { "cmd": "C3", "logType": ["R4"], "role": "R4" } },
                    { "source": "S3", "target": "S2", "label": { "cmd": "C4", "logType": ["R5"], "role": "R5" } },
                    { "source": "S1", "target": "S4", "label": { "cmd": "C5", "logType": ["R6"], "role": "R6" } }
                ]
            }"#,
        )
        .unwrap();
        let subs = serde_json::from_str::<Subscriptions>(
            r#"{
                "R1": ["R1"],
                "R2": ["R2"],
                "R3": ["R3"],
                "R4": ["R4"],
                "R5": ["R5"],
                "R6": ["R6"]
            }"#,
        )
        .unwrap();

        let (graph, initial) = prepare_graph(proto, &subs).unwrap();
        let mut nodes = BTreeMap::new();
        for node in Dfs::new(&graph, initial).iter(&graph) {
            let node = &graph[node];
            nodes.insert(node.name.clone(), (node.active.clone(), node.roles.clone()));
        }
        assert_eq!(nodes["S0"].0, btreeset! {r("R1")});
        assert_eq!(nodes["S1"].0, btreeset! {r("R2"), r("R6")});
        assert_eq!(nodes["S2"].0, btreeset! {r("R3"), r("R4")});
        assert_eq!(nodes["S3"].0, btreeset! {r("R5")});
        assert_eq!(nodes["S4"].0, btreeset! {});

        assert_eq!(
            nodes["S0"].1,
            btreeset! {r("R1"), r("R2"), r("R3"), r("R4"), r("R5"), r("R6")}
        );
        assert_eq!(
            nodes["S1"].1,
            btreeset! {r("R2"), r("R3"), r("R4"), r("R5"), r("R6")}
        );
        assert_eq!(
            nodes["S2"].1,
            btreeset! {r("R2"), r("R3"), r("R4"), r("R5"), r("R6")}
        );
        assert_eq!(
            nodes["S3"].1,
            btreeset! {r("R2"), r("R3"), r("R4"), r("R5"), r("R6")}
        );
        assert_eq!(nodes["S4"].1, btreeset! {});

        let mut errors = well_formed(&graph, initial, subs);
        errors.sort();
        let g = &graph;
        let mut expected = vec![
            Error::LaterActiveRoleNotSubscribed(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R2")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S2)--[C2@R3<R3>]-->(S1)"), r("R2")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S1)--[C1@R2<R2>]-->(S2)"), r("R3")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S3)--[C4@R5<R5>]-->(S2)"), r("R3")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S1)--[C1@R2<R2>]-->(S2)"), r("R4")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S3)--[C4@R5<R5>]-->(S2)"), r("R4")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S2)--[C3@R4<R4>]-->(S3)"), r("R5")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R6")),
            Error::LaterActiveRoleNotSubscribed(e(g, "(S2)--[C2@R3<R3>]-->(S1)"), r("R6")),
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S1)--[C1@R2<R2>]-->(S2)"),
                later: r("R2"),
                active: r("R3"),
                events: btreeset![ev("R2")],
            },
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S1)--[C1@R2<R2>]-->(S2)"),
                later: r("R2"),
                active: r("R4"),
                events: btreeset![ev("R2")],
            },
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S2)--[C2@R3<R3>]-->(S1)"),
                later: r("R3"),
                active: r("R2"),
                events: btreeset![ev("R3")],
            },
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S2)--[C2@R3<R3>]-->(S1)"),
                later: r("R3"),
                active: r("R6"),
                events: btreeset![ev("R3")],
            },
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S2)--[C3@R4<R4>]-->(S3)"),
                later: r("R4"),
                active: r("R5"),
                events: btreeset![ev("R4")],
            },
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S3)--[C4@R5<R5>]-->(S2)"),
                later: r("R5"),
                active: r("R3"),
                events: btreeset![ev("R5")],
            },
            Error::LaterInvolvedRoleMoreSubscribed {
                edge: e(g, "(S3)--[C4@R5<R5>]-->(S2)"),
                later: r("R5"),
                active: r("R4"),
                events: btreeset![ev("R5")],
            },
            Error::LaterInvolvedNotGuarded(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R2")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C2@R3<R3>]-->(S1)"), r("R2")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C3@R4<R4>]-->(S3)"), r("R2")),
            Error::LaterInvolvedNotGuarded(e(g, "(S3)--[C4@R5<R5>]-->(S2)"), r("R2")),
            Error::LaterInvolvedNotGuarded(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R3")),
            Error::LaterInvolvedNotGuarded(e(g, "(S1)--[C1@R2<R2>]-->(S2)"), r("R3")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C3@R4<R4>]-->(S3)"), r("R3")),
            Error::LaterInvolvedNotGuarded(e(g, "(S3)--[C4@R5<R5>]-->(S2)"), r("R3")),
            Error::LaterInvolvedNotGuarded(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R4")),
            Error::LaterInvolvedNotGuarded(e(g, "(S1)--[C1@R2<R2>]-->(S2)"), r("R4")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C2@R3<R3>]-->(S1)"), r("R4")),
            Error::LaterInvolvedNotGuarded(e(g, "(S3)--[C4@R5<R5>]-->(S2)"), r("R4")),
            Error::LaterInvolvedNotGuarded(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R5")),
            Error::LaterInvolvedNotGuarded(e(g, "(S1)--[C1@R2<R2>]-->(S2)"), r("R5")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C2@R3<R3>]-->(S1)"), r("R5")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C3@R4<R4>]-->(S3)"), r("R5")),
            Error::LaterInvolvedNotGuarded(e(g, "(S0)--[C0@R1<R1>]-->(S1)"), r("R6")),
            Error::LaterInvolvedNotGuarded(e(g, "(S1)--[C1@R2<R2>]-->(S2)"), r("R6")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C2@R3<R3>]-->(S1)"), r("R6")),
            Error::LaterInvolvedNotGuarded(e(g, "(S2)--[C3@R4<R4>]-->(S3)"), r("R6")),
            Error::LaterInvolvedNotGuarded(e(g, "(S3)--[C4@R5<R5>]-->(S2)"), r("R6")),
        ];
        expected.sort();
        assert_eq!(errors, expected);
    }

    #[test]
    fn basics() {
        setup_logger();
        // (S0) --(a@R1<A,B,C>)--> (S1) --(b@R2<D,E>)--> (S2)
        let proto = serde_json::from_str::<SwarmProtocol>(
            r#"{
                "initial": "S0",
                "transitions": [
                    { "source": "S0", "target": "S1", "label": { "cmd": "a", "logType": ["A", "B", "C"], "role": "R1" } },
                    { "source": "S1", "target": "S2", "label": { "cmd": "b", "logType": ["D", "E"], "role": "R2" } }
                ]
            }"#,
        )
        .unwrap();
        let subs = serde_json::from_str::<Subscriptions>(
            r#"{
                "R1": ["E"],
                "R3": ["A", "B", "C", "D"]
            }"#,
        )
        .unwrap();
        let mut errors = check(proto, subs).unwrap_err();
        errors.sort();
        assert_eq!(errors, vec![
            "active role does not subscribe to any of its emitted event types in transition (S0)--[a@R1<A,B,C>]-->(S1)",
            "active role does not subscribe to any of its emitted event types in transition (S1)--[b@R2<D,E>]-->(S2)",
            "subsequently active role R2 does not subscribe to events in transition (S0)--[a@R1<A,B,C>]-->(S1)",
            "subsequently involved role R1 does not subscribe to guard in transition (S0)--[a@R1<A,B,C>]-->(S1)",
            "subsequently involved role R3 subscribes to more events than active role R2 in transition (S0)--[a@R1<A,B,C>]-->(S1), namely (A, B, C)"
        ]);
    }

    #[test]
    fn deterministic() {
        setup_logger();
        let proto = serde_json::from_str::<SwarmProtocol>(
            r#"{
                "initial": "S0",
                "transitions": [
                    { "source": "S0", "target": "S1", "label": { "cmd": "a", "logType": ["A"], "role": "R" } },
                    { "source": "S1", "target": "S2", "label": { "cmd": "b", "logType": ["B", "A"], "role": "R" } },
                    { "source": "S2", "target": "S3", "label": { "cmd": "c", "logType": ["A"], "role": "R" } },
                    { "source": "S2", "target": "S3", "label": { "cmd": "c", "logType": ["C"], "role": "R" } },
                    { "source": "S2", "target": "S3", "label": { "cmd": "d", "logType": ["A"], "role": "R" } },
                    { "source": "S2", "target": "S3", "label": { "cmd": "c", "logType": ["A"], "role": "S" } },
                    { "source": "S2", "target": "S3", "label": { "cmd": "d", "logType": ["A"], "role": "S" } }
                ]
            }"#,
        )
        .unwrap();
        let mut errors = check(proto, BTreeMap::new()).unwrap_err();
        errors.sort();
        assert_eq!(errors, vec![
            "active role does not subscribe to any of its emitted event types in transition (S0)--[a@R<A>]-->(S1)",
            "active role does not subscribe to any of its emitted event types in transition (S1)--[b@R<B,A>]-->(S2)",
            "active role does not subscribe to any of its emitted event types in transition (S2)--[c@R<A>]-->(S3)",
            "active role does not subscribe to any of its emitted event types in transition (S2)--[c@R<C>]-->(S3)",
            "active role does not subscribe to any of its emitted event types in transition (S2)--[c@S<A>]-->(S3)",
            "active role does not subscribe to any of its emitted event types in transition (S2)--[d@R<A>]-->(S3)",
            "active role does not subscribe to any of its emitted event types in transition (S2)--[d@S<A>]-->(S3)",
            "guard event type A appears in transitions from multiple states",
            "non-deterministic command c for role R in state S2",
            "non-deterministic event guard type A in state S2",
            "subsequently active role R does not subscribe to events in transition (S0)--[a@R<A>]-->(S1)",
            "subsequently active role R does not subscribe to events in transition (S1)--[b@R<B,A>]-->(S2)",
            "subsequently active role S does not subscribe to events in transition (S1)--[b@R<B,A>]-->(S2)",
        ]);
    }

    #[test]
    fn empty_log() {
        setup_logger();
        let proto = serde_json::from_str::<SwarmProtocol>(
            r#"{
                "initial": "S0",
                "transitions": [
                    { "source": "S0", "target": "S1", "label": { "cmd": "a", "logType": ["A", "B", "C"], "role": "R1" } },
                    { "source": "S1", "target": "S2", "label": { "cmd": "b", "logType": [], "role": "R2" } }
                ]
            }"#,
        )
        .unwrap();
        let mut errors = check(proto, BTreeMap::new()).unwrap_err();
        errors.sort();
        assert_eq!(
            errors,
            vec!["log type must not be empty (S1)--[b@R2<>]-->(S2)"]
        );
    }

    #[test]
    fn disconnected_initial() {
        setup_logger();
        let proto = serde_json::from_str::<SwarmProtocol>(
            r#"{
                "initial": "S5",
                "transitions": [
                    { "source": "S0", "target": "S1", "label": { "cmd": "a", "logType": ["A", "B", "C"], "role": "R1" } },
                    { "source": "S1", "target": "S2", "label": { "cmd": "b", "logType": [], "role": "R2" } }
                ]
            }"#,
        )
        .unwrap();
        let mut errors = check(proto, BTreeMap::new()).unwrap_err();
        errors.sort();
        assert_eq!(
            errors,
            vec![
                "initial state has no transitions",
                "log type must not be empty (S1)--[b@R2<>]-->(S2)",
            ]
        );
    }
}
