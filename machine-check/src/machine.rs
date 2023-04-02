use crate::{
    types::{MachineLabel, Role, State},
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
    let mut machine = Graph::new();
    let sub = BTreeSet::new();
    let sub = subs.get(&role).unwrap_or(&sub);
    let interested = |edge: ERef| edge.weight().log_type.iter().any(|ev| sub.contains(ev));
    let filtered = EdgeFiltered(swarm, interested);
    // need to keep track of corresponding machine node for each swarm node
    let mut m_nodes = vec![NodeId::end(); swarm.node_count()];
    // first loop creates all relevant (corresponding) nodes and transfers commands
    for s_node in Dfs::new(&filtered, initial).iter(&filtered) {
        let m_node = machine.add_node(Some(swarm[s_node].clone()));
        m_nodes[s_node.index()] = m_node;
        for edge in filtered.edges_directed(s_node, Outgoing) {
            if edge.weight().role == role {
                let l = edge.weight();
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
    // second loop inserts all event input edges since now the node mapping is complete
    for s_node in Dfs::new(&filtered, initial).iter(&filtered) {
        let m_node = m_nodes[s_node.index()];
        for edge in filtered.edges_directed(s_node, Incoming) {
            let start = m_nodes[edge.source().index()];
            let log = edge.weight().log_type.as_slice();
            // we need to turn a log of length N into N transitions, i.e. we need N-1 synthetic intermediate states
            let middle = (1..log.len())
                .map(|_| machine.add_node(None))
                .collect::<Vec<_>>();
            let states = once(start).chain(middle).chain(once(m_node));
            for ((from, to), ev) in states.tuple_windows().zip(log.iter()) {
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

pub fn from_json(proto: Machine) -> (Graph, Option<NodeId>) {
    let mut machine = Graph::new();
    let mut nodes = HashMap::new();
    for t in proto.transitions {
        tracing::debug!("adding {} --({:?})--> {}", t.source, t.label, t.target);
        let source = *nodes
            .entry(t.source.clone())
            .or_insert_with(|| machine.add_node(Some(t.source)));
        let target = *nodes
            .entry(t.target.clone())
            .or_insert_with(|| machine.add_node(Some(t.target)));
        machine.add_edge(source, target, t.label);
    }
    (machine, nodes.get(&proto.initial).copied())
}

pub enum Side {
    Left,
    Right,
}

pub enum Error {
    NonDeterministic(Side, EdgeId),
    MissingTransition(Side, EdgeId),
}

impl Error {
    pub fn to_string(&self, left: &Graph, right: &Graph) -> String {
        match self {
            Error::NonDeterministic(Side::Left, edge) => {
                let Some((state, _)) = left.edge_endpoints(*edge) else {
                    return format!("non-deterministic transition");
                };
                let state = state_name(left, state);
                let label = left.edge_weight(*edge).unwrap();
                format!("non-deterministic transition {label} in state {state}")
            }
            Error::NonDeterministic(Side::Right, edge) => {
                let Some((state, _)) = right.edge_endpoints(*edge) else {
                    return format!("non-deterministic transition");
                };
                let state = state_name(right, state);
                let label = right.edge_weight(*edge).unwrap();
                format!("non-deterministic transition {label} in state {state}")
            }
            Error::MissingTransition(Side::Left, edge) => {
                let Some((state, _)) = left.edge_endpoints(*edge) else {
                    return format!("non-deterministic transition");
                };
                let state = state_name(left, state);
                let label = left.edge_weight(*edge).unwrap();
                format!("extraneous transition {label} in state {state}")
            }
            Error::MissingTransition(Side::Right, edge) => {
                let Some((state, _)) = right.edge_endpoints(*edge) else {
                    return format!("non-deterministic transition");
                };
                let state = state_name(right, state);
                let label = right.edge_weight(*edge).unwrap();
                format!("missing transition {label} in state {state}")
            }
        }
    }

    pub fn convert<'a>(left: &'a Graph, right: &'a Graph) -> impl Fn(Error) -> String + 'a {
        |err| err.to_string(left, right)
    }
}

struct StatePrinter<'a>(&'a State, u32);

impl<'a> fmt::Display for StatePrinter<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)?;
        if self.1 > 0 {
            write!(f, "(+{})", self.1)?;
        }
        Ok(())
    }
}

fn state_name(g: &Graph, mut n: NodeId) -> StatePrinter<'_> {
    let mut offset = 0;
    loop {
        if let Some(state) = &g[n] {
            return StatePrinter(state, offset);
        }
        n = g
            .neighbors_directed(n, Incoming)
            .next()
            .expect("unnamed state must track back to named state");
        offset += 1;
    }
}

/// error messages are designed assuming that `left` is the reference and `right` the tested
pub fn equivalent(left: &Graph, li: NodeId, right: &Graph, ri: NodeId) -> Vec<Error> {
    use Side::*;

    let mut errors = Vec::new();
    let mut l2r = vec![NodeId::end(); left.node_count()];
    let mut r2l = vec![NodeId::end(); right.node_count()];

    // dfs traversal stack
    // must hold index pairs because node mappings might be m:n
    let mut stack = vec![(li, ri)];

    while let Some((li, ri)) = stack.pop() {
        // get all outgoing edge labels for the left side
        let mut l_out = BTreeMap::new();
        for edge in left.edges_directed(li, Outgoing) {
            l_out
                .entry(edge.weight())
                .and_modify(|_| errors.push(Error::NonDeterministic(Left, edge.id())))
                .or_insert(edge);
        }
        // get all outgoing edge labels for the right side
        let mut r_out = BTreeMap::new();
        for edge in right.edges_directed(ri, Outgoing) {
            r_out
                .entry(edge.weight())
                .and_modify(|_| errors.push(Error::NonDeterministic(Right, edge.id())))
                .or_insert(edge);
        }
        // keep note of stack so we can undo additions if !same
        let stack_len = stack.len();
        // note that we have visited these nodes (to avoid putting self-loops onto the stack in the loop below)
        l2r[li.index()] = ri;
        r2l[ri.index()] = li;
        // compare both sets
        let mut same = true;
        let mut l_edges = l_out.into_iter().peekable();
        let mut r_edges = r_out.into_iter().peekable();
        loop {
            let l = l_edges.peek();
            let r = r_edges.peek();
            match (l, r) {
                (None, None) => break,
                (None, Some((_, r_edge))) => {
                    errors.push(Error::MissingTransition(Left, r_edge.id()));
                    same = false;
                    r_edges.next();
                }
                (Some((_, l_edge)), None) => {
                    errors.push(Error::MissingTransition(Right, l_edge.id()));
                    same = false;
                    l_edges.next();
                }
                (Some((l, l_edge)), Some((r, r_edge))) => match l.cmp(r) {
                    Ordering::Less => {
                        errors.push(Error::MissingTransition(Right, l_edge.id()));
                        same = false;
                        l_edges.next();
                    }
                    Ordering::Equal => {
                        let lt = l_edge.target();
                        let rt = r_edge.target();
                        if l2r[lt.index()] != NodeId::end() || r2l[rt.index()] != NodeId::end() {
                            stack.push((lt, rt));
                        }
                        l_edges.next();
                        r_edges.next();
                    }
                    Ordering::Greater => {
                        errors.push(Error::MissingTransition(Left, r_edge.id()));
                        same = false;
                        r_edges.next();
                    }
                },
            }
        }
        if !same {
            // don’t bother visiting subsequent nodes if this one had discrepancies
            stack.truncate(stack_len);
        }
    }

    errors
}
