use crate::{Role, Subscriptions, SwarmLabel, SwarmProtocol};
use bitvec::{bitvec, vec::BitVec};
use itertools::Itertools;
use petgraph::{
    visit::{Dfs, DfsPostOrder, EdgeRef, GraphBase, Walker},
    Direction::{Incoming, Outgoing},
};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    mem::take,
};

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
type NodeId = <Graph as GraphBase>::NodeId;

pub fn check(proto: SwarmProtocol, subs: Subscriptions) -> Result<(), Vec<String>> {
    let (graph, initial) = prepare_graph(proto, &subs)?;
    well_formed(graph, initial, subs)
}

fn well_formed(graph: Graph, initial: NodeId, subs: Subscriptions) -> Result<(), Vec<String>> {
    let mut errors = Vec::new();
    let empty = BTreeSet::new();
    let sub = |r: &Role| subs.get(&**r).unwrap_or(&empty);
    for node in Dfs::new(&graph, initial).iter(&graph) {
        let state = &graph[node].name;
        for edge in graph.edges_directed(node, Outgoing) {
            let log = edge.weight().log_type.as_slice();
            let role = Role::new(&edge.weight().role);
            let target = edge.target();
            let state2 = &graph[target].name;
            // causal consistency
            if log_filter(log, sub(&role)).first_one().is_none() {
                errors.push(format!(
                    "active role {role} in state {state} does not subscribe to any of its emitted event types"
                ));
            }
            for active in &graph[target].active {
                let filtered = log_filter(log, sub(active));
                if filtered.first_one().is_none() {
                    errors.push(format!(
                        "subsequently active role {active} in state {state2} \
                          does not subscribe to events emitted in transition \
                          {state} --({})--> {state2}",
                        edge.weight(),
                    ));
                }
                for later in &graph[target].roles {
                    let later_log = log_filter(log, sub(later));
                    let extra = later_log & !filtered.clone();
                    if extra.first_one().is_some() {
                        errors.push(format!(
                            "subsequently involved role {later} subscribes to further events than role {active} \
                              (namely {}) in transition {state} --({})--> {state2}",
                            extra.iter_ones().map(|i| &log[i]).join(", "),
                            edge.weight()
                        ));
                    }
                }
            }
            // choice determinacy
            let first_event = &log[0];
            for later in &graph[target].roles {
                if !sub(later).contains(first_event) {
                    errors.push(format!(
                        "subsequently involved role {later} does not subscribe to guard in transition \
                         {state} --({})--> {state2}",
                        edge.weight()
                    ));
                }
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn prepare_graph(
    proto: SwarmProtocol,
    subs: &Subscriptions,
) -> Result<(Graph, NodeId), Vec<String>> {
    let mut errors = Vec::new();
    let mut graph = Graph::new();
    let mut nodes = HashMap::<String, NodeId>::new();
    for t in proto.transitions {
        tracing::debug!("adding {} --({:?})--> {}", t.source, t.label, t.target);
        if t.label.log_type.len() == 0 {
            errors.push(format!(
                "log type must not be empty ({} --({})--> {})",
                t.source, t.label, t.target
            ));
        }
        let source = *nodes
            .entry(t.source.clone())
            .or_insert_with(|| graph.add_node(Node::new(t.source)));
        let target = *nodes
            .entry(t.target.clone())
            .or_insert_with(|| graph.add_node(Node::new(t.target)));
        graph.add_edge(source, target, t.label.clone());
        tracing::debug!("added {:?} --> {:?}", source, target);
    }
    let initial = if let Some(idx) = nodes.get(&proto.initial) {
        tracing::debug!("initial state {:?}", idx);
        *idx
    } else {
        errors.push("initial state has no transitions".to_owned());
        return Err(errors);
    };

    // compute the needed Node information
    // - first post-order walk to propagate non-loop roles back
    // - then keep fixing loop-ends until graph is stable
    let mut walk = DfsPostOrder::new(&graph, initial);
    let mut loop_end = HashSet::new();
    while let Some(node_id) = walk.next(&graph) {
        let active = active(&graph, node_id);
        graph[node_id].active = active;
        let roles = involved(&graph, node_id, &subs, &mut loop_end);
        graph[node_id].roles = roles;
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

    if errors.is_empty() {
        Ok((graph, initial))
    } else {
        Err(errors)
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

    #[test]
    fn prep_cycles() {
        setup_logger();
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

        let mut errors = well_formed(graph, initial, subs).unwrap_err();
        errors.sort();
        assert_eq!(errors, vec![
            "subsequently active role R2 in state S1 does not subscribe to events emitted in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently active role R2 in state S1 does not subscribe to events emitted in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently active role R3 in state S2 does not subscribe to events emitted in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently active role R3 in state S2 does not subscribe to events emitted in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently active role R4 in state S2 does not subscribe to events emitted in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently active role R4 in state S2 does not subscribe to events emitted in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently active role R5 in state S3 does not subscribe to events emitted in transition S2 --(C3@R4<R4>)--> S3",
            "subsequently active role R6 in state S1 does not subscribe to events emitted in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently active role R6 in state S1 does not subscribe to events emitted in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R2 does not subscribe to guard in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently involved role R2 does not subscribe to guard in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R2 does not subscribe to guard in transition S2 --(C3@R4<R4>)--> S3",
            "subsequently involved role R2 does not subscribe to guard in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently involved role R2 subscribes to further events than role R3 (namely R2) in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently involved role R2 subscribes to further events than role R4 (namely R2) in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently involved role R3 does not subscribe to guard in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently involved role R3 does not subscribe to guard in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently involved role R3 does not subscribe to guard in transition S2 --(C3@R4<R4>)--> S3",
            "subsequently involved role R3 does not subscribe to guard in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently involved role R3 subscribes to further events than role R2 (namely R3) in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R3 subscribes to further events than role R6 (namely R3) in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R4 does not subscribe to guard in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently involved role R4 does not subscribe to guard in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently involved role R4 does not subscribe to guard in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R4 does not subscribe to guard in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently involved role R4 subscribes to further events than role R5 (namely R4) in transition S2 --(C3@R4<R4>)--> S3",
            "subsequently involved role R5 does not subscribe to guard in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently involved role R5 does not subscribe to guard in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently involved role R5 does not subscribe to guard in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R5 does not subscribe to guard in transition S2 --(C3@R4<R4>)--> S3",
            "subsequently involved role R5 subscribes to further events than role R3 (namely R5) in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently involved role R5 subscribes to further events than role R4 (namely R5) in transition S3 --(C4@R5<R5>)--> S2",
            "subsequently involved role R6 does not subscribe to guard in transition S0 --(C0@R1<R1>)--> S1",
            "subsequently involved role R6 does not subscribe to guard in transition S1 --(C1@R2<R2>)--> S2",
            "subsequently involved role R6 does not subscribe to guard in transition S2 --(C2@R3<R3>)--> S1",
            "subsequently involved role R6 does not subscribe to guard in transition S2 --(C3@R4<R4>)--> S3",
            "subsequently involved role R6 does not subscribe to guard in transition S3 --(C4@R5<R5>)--> S2"
        ]);
    }

    #[test]
    fn basics() {
        setup_logger();
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
            "active role R1 in state S0 does not subscribe to any of its emitted event types",
            "active role R2 in state S1 does not subscribe to any of its emitted event types",
            "subsequently active role R2 in state S1 does not subscribe to events emitted in transition S0 --(a@R1<A,B,C>)--> S1",
            "subsequently involved role R1 does not subscribe to guard in transition S0 --(a@R1<A,B,C>)--> S1",
            "subsequently involved role R3 subscribes to further events than role R2 (namely A, B, C) in transition S0 --(a@R1<A,B,C>)--> S1"
        ]);
    }
}
