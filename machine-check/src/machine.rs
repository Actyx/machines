use crate::{
    types::{MachineLabel, Role, State},
    NodeId, Subscriptions,
};
use itertools::Itertools;
use petgraph::{
    visit::{Dfs, EdgeFiltered, EdgeRef, IntoEdgeReferences, IntoEdgesDirected, Walker},
    Direction::{Incoming, Outgoing},
};
use std::{collections::BTreeSet, iter::once};

type Graph = petgraph::Graph<Option<State>, MachineLabel>;
type ERef<'a> = <&'a super::Graph as IntoEdgeReferences>::EdgeRef;

pub fn project(swarm: &super::Graph, initial: NodeId, subs: &Subscriptions, role: Role) -> Graph {
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
    machine
}
