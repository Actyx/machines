use crate::{err, Role, Subscriptions, SwarmLabel, SwarmProtocol};
use petgraph::{
    visit::{DfsPostOrder, EdgeRef, GraphBase},
    Direction::{Incoming, Outgoing},
};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    mem::take,
};

#[derive(Debug, Default)]
struct Node {
    active: BTreeSet<Role>,
    roles: BTreeSet<Role>,
}

type Graph = petgraph::Graph<Node, SwarmLabel>;
type NodeId = <Graph as GraphBase>::NodeId;
type EdgeId = <Graph as GraphBase>::EdgeId;

pub fn check(proto: SwarmProtocol, subs: Subscriptions) -> Result<(), Vec<String>> {
    let graph = prepare_graph(proto, subs)?;
    Ok(())
}

fn prepare_graph(proto: SwarmProtocol, subs: Subscriptions) -> Result<Graph, Vec<String>> {
    let mut graph = Graph::new();
    let mut nodes = HashMap::<String, NodeId>::new();
    for t in &proto.transitions {
        let source = *nodes
            .entry(t.source.clone())
            .or_insert_with(|| graph.add_node(Node::default()));
        let target = *nodes
            .entry(t.target.clone())
            .or_insert_with(|| graph.add_node(Node::default()));
        graph.add_edge(source, target, t.label.clone());
    }
    let initial = if let Some(idx) = nodes.get(&proto.initial) {
        *idx
    } else {
        return err(["initial state has no transitions"]);
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

    Ok(graph)
}

fn propagate_back(g: &mut Graph, node: NodeId) {
    let mut queue = vec![node];
    rec(g, &mut queue);
    fn rec(g: &mut Graph, q: &mut Vec<NodeId>) {
        let Some(node_id) = q.pop() else { return };
        let target_roles = take(&mut g[node_id].roles);
        let mut walk = g.neighbors_directed(node_id, Incoming).detach();
        while let Some(source) = walk.next_node(g) {
            let source_roles = &mut g[source].roles;
            let num_roles = source_roles.len();
            source_roles.extend(target_roles.iter().cloned());
            if source_roles.len() > num_roles {
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
    let mut roles = BTreeSet::new();
    for edge in g.edges_directed(node, Outgoing) {
        // first propagate back all roles from target state
        let target = edge.target();
        let target_roles = &g[target].roles;
        if target_roles.is_empty() {
            loop_end.insert(node);
        } else {
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
                roles.insert(role);
            }
        }
    }
    roles
}

fn active(g: &Graph, node: NodeId) -> BTreeSet<Role> {
    let mut active = BTreeSet::new();
    for x in g.edges_directed(node, Outgoing) {
        active.insert(Role::new(&x.weight().role));
    }
    active
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prep_cycles() {
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

        let graph = prepare_graph(proto, subs).unwrap();
    }
}
