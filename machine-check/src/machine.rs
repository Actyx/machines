use crate::{
    types::{Command, EventType, MachineLabel, Role, State},
    EdgeId, Machine, NodeId, Subscriptions,
};
use itertools::Itertools;
use petgraph::{
    visit::{Dfs, EdgeFiltered, EdgeRef, IntoEdgeReferences, IntoEdgesDirected, Walker},
    Direction::{Incoming, Outgoing},
};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, HashMap},
    fmt,
    iter::once,
};

type Graph = petgraph::Graph<Option<State>, MachineLabel>;
type ERef<'a> = <&'a super::Graph as IntoEdgeReferences>::EdgeRef;

pub fn project(
    swarm: &super::Graph,
    initial: NodeId,
    subs: &Subscriptions,
    role: Role,
) -> (Graph, NodeId) {
    let _span = tracing::debug_span!("project", %role).entered();
    /*
     * Machine will be a graph containing:
     * - nodes which are corresponding nodes of "interesting" edges (but not the edges themselves);
     * - self-loop edges from/to each node of the above nodes, representing commands
     * - intermediate nodes and edges which is derived from log_types of each of the "interesting edges"
     *
     * Note:
     * - "interesting edges": edges which the log_type of intersect with sub.get(role)
     */
    let mut machine = Graph::new();
    let sub = BTreeSet::new();
    let sub = subs.get(&role).unwrap_or(&sub);
    let interested = |edge: ERef| edge.weight().log_type.iter().any(|ev| sub.contains(ev));
    let filtered = EdgeFiltered(swarm, interested);
    // need to keep track of corresponding machine node for each swarm node
    let mut m_nodes = vec![NodeId::end(); swarm.node_count()];
    // first loop creates all relevant (corresponding) nodes and transfers commands
    for s_node in Dfs::new(&filtered, initial).iter(&filtered) {
        tracing::debug!("adding state {} {s_node:?}", swarm[s_node]);
        let m_node = machine.add_node(Some(swarm[s_node].clone()));
        m_nodes[s_node.index()] = m_node;
        for edge in filtered.edges_directed(s_node, Outgoing) {
            if edge.weight().role == role {
                let l = edge.weight();
                tracing::debug!("adding command {}", l.cmd);
                machine.add_edge(
                    m_node,
                    m_node,
                    MachineLabel::Execute {
                        cmd: l.cmd.clone(),
                        log_type: l.log_type.clone(),
                    },
                );
            }
        }
    }
    tracing::debug!("nodes created");
    // second loop inserts all event input edges since now the node mapping is complete
    for s_node in Dfs::new(&filtered, initial).iter(&filtered) {
        tracing::debug!("adding transitions into state {}", swarm[s_node]);
        let m_node = m_nodes[s_node.index()];
        for edge in filtered.edges_directed(s_node, Incoming) {
            let start = m_nodes[edge.source().index()];
            let log = edge.weight().log_type.iter().filter(|ev| sub.contains(*ev));
            let evs = log.clone().count();
            // we need to turn a log of length N into N transitions, i.e. we need N-1 synthetic intermediate states
            let middle = (1..evs).map(|_| machine.add_node(None)).collect::<Vec<_>>();
            let states = once(start).chain(middle).chain(once(m_node));
            for ((from, to), ev) in states.tuple_windows().zip(log) {
                tracing::debug!(
                    "adding transition {}->{}->{}",
                    swarm[start],
                    ev,
                    swarm[s_node]
                );
                machine.add_edge(
                    from,
                    to,
                    MachineLabel::Input {
                        event_type: ev.clone(),
                    },
                );
            }
        }
    }
    (machine, m_nodes[initial.index()])
}

pub fn from_json(proto: Machine) -> (Graph, Option<NodeId>, Vec<String>) {
    let _span = tracing::debug_span!("from_json").entered();
    let mut errors = Vec::new();
    let mut machine = Graph::new();
    let mut nodes = HashMap::new();
    for t in proto.transitions {
        tracing::debug!("adding {} --({:?})--> {}", t.source, t.label, t.target);
        let source = *nodes
            .entry(t.source.clone())
            .or_insert_with(|| machine.add_node(Some(t.source.clone())));
        let target = *nodes
            .entry(t.target.clone())
            .or_insert_with(|| machine.add_node(Some(t.target)));
        if let (MachineLabel::Execute { cmd, .. }, true) = (&t.label, source != target) {
            errors.push(format!(
                "command {cmd} is not a self-loop in state {}",
                t.source
            ));
        }
        machine.add_edge(source, target, t.label);
    }
    (machine, nodes.get(&proto.initial).copied(), errors)
}

pub enum Side {
    Left,
    Right,
}

pub enum Error {
    /// The given edge’s label is not unique for this side: a machine can have only one reaction
    /// to a given event or one handler for a given command
    NonDeterministic(Side, EdgeId),
    /// The given side in the given node is missing the edge from the OTHER side
    MissingTransition(Side, NodeId, EdgeId),
}

impl Error {
    pub fn to_string(&self, left: &Graph, right: &Graph) -> String {
        match self {
            Error::NonDeterministic(Side::Left, edge) => {
                let Some((state, _)) = left.edge_endpoints(*edge) else {
                    return format!("non-deterministic transition in reference");
                };
                let state = state_name(left, state);
                let label = left.edge_weight(*edge).unwrap();
                format!("non-deterministic transition {label} in state {state} of the reference")
            }
            Error::NonDeterministic(Side::Right, edge) => {
                let Some((state, _)) = right.edge_endpoints(*edge) else {
                    return format!("non-deterministic transition in specimen");
                };
                let state = state_name(right, state);
                let label = right.edge_weight(*edge).unwrap();
                format!("non-deterministic transition {label} in state {state} of the specimen")
            }
            Error::MissingTransition(Side::Left, l_node, r_edge) => {
                let state = state_name(left, *l_node);
                let label = right
                    .edge_weight(*r_edge)
                    .map(|l| l.to_string())
                    .unwrap_or_else(|| "[invalid]".to_owned());
                format!("extraneous transition {label} in state {state}")
            }
            Error::MissingTransition(Side::Right, r_node, l_edge) => {
                let state = state_name(right, *r_node);
                let Some((from, _)) = left.edge_endpoints(*l_edge) else {
                    return format!("missing transition in {state}");
                };
                let from = state_name(left, from);
                let label = left.edge_weight(*l_edge).unwrap();
                format!("missing transition {label} in state {state} (from reference state {from})")
            }
        }
    }

    pub fn convert<'a>(left: &'a Graph, right: &'a Graph) -> impl Fn(Error) -> String + 'a {
        |err| err.to_string(left, right)
    }
}

struct StatePrinter<'a>(Option<&'a State>, u32);

impl<'a> fmt::Display for StatePrinter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0.map(|s| s.as_ref()).unwrap_or("[invalid]"))?;
        if self.1 > 0 {
            write!(f, "(+{})", self.1)?;
        }
        Ok(())
    }
}

fn state_name(g: &Graph, mut n: NodeId) -> StatePrinter<'_> {
    let mut offset = 0;
    loop {
        match g.node_weight(n) {
            Some(Some(state)) => return StatePrinter(Some(state), offset),
            None => return StatePrinter(None, offset),
            _ => {}
        }
        tracing::debug!(?n, "tracking back");
        n = g
            .neighbors_directed(n, Incoming)
            .next()
            .expect("unnamed state must track back to named state");
        offset += 1;
    }
}

#[derive(Debug, Clone, PartialEq, PartialOrd, Eq, Ord)]
enum DeterministicLabel {
    Command(Command),
    Event(EventType),
}

impl From<&MachineLabel> for DeterministicLabel {
    fn from(label: &MachineLabel) -> Self {
        match label {
            MachineLabel::Execute { cmd, .. } => DeterministicLabel::Command(cmd.clone()),
            MachineLabel::Input { event_type } => DeterministicLabel::Event(event_type.clone()),
        }
    }
}

/// error messages are designed assuming that `left` is the reference and `right` the tested
pub fn equivalent(left: &Graph, li: NodeId, right: &Graph, ri: NodeId) -> Vec<Error> {
    use Side::*;

    let _span = tracing::debug_span!("equivalent").entered();

    let mut errors = Vec::new();
    let mut l2r = vec![NodeId::end(); left.node_count()];
    let mut r2l = vec![NodeId::end(); right.node_count()];

    // dfs traversal stack
    // must hold index pairs because node mappings might be m:n
    let mut stack = vec![(li, ri)];

    while let Some((li, ri)) = stack.pop() {
        tracing::debug!(left = %state_name(left, li), ?li, right = %state_name(right, ri), ?ri, to_go = stack.len(), "loop");
        // get all outgoing edge labels for the left side
        let mut l_out = BTreeMap::new();
        for edge in left.edges_directed(li, Outgoing) {
            l_out
                .entry(DeterministicLabel::from(edge.weight()))
                .and_modify(|_| errors.push(Error::NonDeterministic(Left, edge.id())))
                .or_insert(edge);
        }
        // get all outgoing edge labels for the right side
        let mut r_out = BTreeMap::new();
        for edge in right.edges_directed(ri, Outgoing) {
            r_out
                .entry(DeterministicLabel::from(edge.weight()))
                .and_modify(|_| errors.push(Error::NonDeterministic(Right, edge.id())))
                .or_insert(edge);
        }
        // keep note of stack so we can undo additions if !same
        let stack_len = stack.len();
        // note that we have visited these nodes (to avoid putting self-loops onto the stack in the loop below)
        l2r[li.index()] = ri;
        r2l[ri.index()] = li;
        // compare both sets; iteration must be in order of weights (hence the BTreeMap above)
        let mut same = true;
        let mut l_edges = l_out.into_values().peekable();
        let mut r_edges = r_out.into_values().peekable();
        loop {
            let l = l_edges.peek();
            let r = r_edges.peek();
            match (l, r) {
                (None, None) => break,
                (None, Some(r_edge)) => {
                    tracing::debug!("left missing {}", r_edge.weight());
                    errors.push(Error::MissingTransition(Left, li, r_edge.id()));
                    same = false;
                    r_edges.next();
                }
                (Some(l_edge), None) => {
                    tracing::debug!("right missing {}", l_edge.weight());
                    errors.push(Error::MissingTransition(Right, ri, l_edge.id()));
                    same = false;
                    l_edges.next();
                }
                (Some(l_edge), Some(r_edge)) => match l_edge.weight().cmp(r_edge.weight()) {
                    Ordering::Less => {
                        tracing::debug!("right missing {}", l_edge.weight());
                        errors.push(Error::MissingTransition(Right, ri, l_edge.id()));
                        same = false;
                        l_edges.next();
                    }
                    Ordering::Equal => {
                        tracing::debug!("found match for {}", l_edge.weight());
                        let lt = l_edge.target();
                        let rt = r_edge.target();
                        if l2r[lt.index()] == NodeId::end() || r2l[rt.index()] == NodeId::end() {
                            tracing::debug!(?lt, ?rt, "pushing targets");
                            stack.push((lt, rt));
                        }
                        l_edges.next();
                        r_edges.next();
                    }
                    Ordering::Greater => {
                        tracing::debug!("left missing {}", r_edge.weight());
                        errors.push(Error::MissingTransition(Left, li, r_edge.id()));
                        same = false;
                        r_edges.next();
                    }
                },
            }
        }
        if !same {
            // don’t bother visiting subsequent nodes if this one had discrepancies
            tracing::debug!("dumping {} stack elements", stack.len() - stack_len);
            stack.truncate(stack_len);
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use tracing_subscriber::{fmt, fmt::format::FmtSpan, EnvFilter};

    fn setup_logger() {
        fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .with_span_events(FmtSpan::ENTER | FmtSpan::CLOSE)
            .try_init()
            .ok();
    }

    #[test]
    fn paper() {
        setup_logger();
        let swarm = r#"{
            "initial":"S0",
            "transitions":[
                {"source":"S0","target":"S1","label":{"role":"P","cmd":"Request","logType":["Requested"]}},
                {"source":"S1","target":"S2","label":{"role":"T","cmd":"Offer","logType":["Bid","BidderID"]}},
                {"source":"S2","target":"S2","label":{"role":"T","cmd":"Offer","logType":["Bid","BidderID"]}},
                {"source":"S2","target":"S3","label":{"role":"P","cmd":"Select","logType":["Selected","PassengerID"]}},
                {"source":"S3","target":"S6","label":{"role":"P","cmd":"Cancel","logType":["Cancelled"]}},
                {"source":"S3","target":"S4","label":{"role":"T","cmd":"Arrive","logType":["Arrived"]}},
                {"source":"S4","target":"S5","label":{"role":"P","cmd":"Start","logType":["Started"]}},
                {"source":"S5","target":"S5","label":{"role":"T","cmd":"Record","logType":["Path"]}},
                {"source":"S5","target":"S6","label":{"role":"P","cmd":"Finish","logType":["Finished","Rating"]}},
                {"source":"S6","target":"S7","label":{"role":"O","cmd":"Receipt","logType":["Receipt"]}}
            ]}"#;
        let subs = r#"{
            "P":["Requested","Bid","BidderID","Selected","PassengerID","Cancelled","Arrived","Started","Path","Finished","Receipt"],
            "T":["Requested","Bid","BidderID","Selected","PassengerID","Cancelled","Arrived","Started","Path","Finished","Receipt"],
            "O":["Requested","Bid","Selected","Cancelled","Arrived","Started","Path","Finished","Receipt"]
        }"#;
        let machine = r#"{
            "initial":"S0",
            "transitions":[
                {"source":"S0","target":"S0","label":{"tag":"Execute","cmd":"Request","logType":["Requested"]}},
                {"source":"S0","target":"S1","label":{"tag":"Input","eventType":"Requested"}},
                {"source":"S1","target":"S2","label":{"tag":"Input","eventType":"Bid"}},
                {"source":"S2","target":"S3","label":{"tag":"Input","eventType":"BidderID"}},
                {"source":"S3","target":"S3","label":{"tag":"Execute","cmd":"Select","logType":["Selected","PassengerID"]}},
                {"source":"S3","target":"S4","label":{"tag":"Input","eventType":"Bid"}},
                {"source":"S4","target":"S3","label":{"tag":"Input","eventType":"BidderID"}},
                {"source":"S3","target":"S5","label":{"tag":"Input","eventType":"Selected"}},
                {"source":"S5","target":"S6","label":{"tag":"Input","eventType":"PassengerID"}},
                {"source":"S6","target":"S6","label":{"tag":"Execute","cmd":"Cancel","logType":["Cancelled"]}},
                {"source":"S6","target":"S7","label":{"tag":"Input","eventType":"Cancelled"}},
                {"source":"S6","target":"S8","label":{"tag":"Input","eventType":"Arrived"}},
                {"source":"S8","target":"S8","label":{"tag":"Execute","cmd":"Start","logType":["Started"]}},
                {"source":"S8","target":"S9","label":{"tag":"Input","eventType":"Started"}},
                {"source":"S9","target":"S9","label":{"tag":"Input","eventType":"Path"}},
                {"source":"S9","target":"S9","label":{"tag":"Execute","cmd":"Finish","logType":["Finished","Rating"]}},
                {"source":"S9","target":"S7","label":{"tag":"Input","eventType":"Finished"}},
                {"source":"S7","target":"S10","label":{"tag":"Input","eventType":"Receipt"}}
            ]}"#;

        let result = crate::check_projection(
            swarm.to_owned(),
            subs.to_owned(),
            "P".to_owned(),
            machine.to_owned(),
        );
        assert_eq!(
            result,
            r#"{"type":"ERROR","errors":["guard event type Bid appears in transitions from multiple states"]}"#
        );
    }
}
