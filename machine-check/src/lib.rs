use std::collections::{BTreeMap, BTreeSet};
use wasm_bindgen::prelude::*;

mod machine;
mod swarm;
pub mod types;

use petgraph::visit::GraphBase;
use types::{CheckResult, EventType, MachineLabel, Protocol, Role, State, SwarmLabel};

pub type Subscriptions = BTreeMap<Role, BTreeSet<EventType>>;
pub type SwarmProtocol = Protocol<SwarmLabel>;
pub type Machine = Protocol<MachineLabel>;

pub type Graph = petgraph::Graph<State, SwarmLabel>;
pub type NodeId = <petgraph::Graph<(), ()> as GraphBase>::NodeId;
pub type EdgeId = <petgraph::Graph<(), ()> as GraphBase>::EdgeId;

#[wasm_bindgen]
pub fn check_swarm(proto: String, subs: String) -> String {
    let proto = match serde_json::from_str::<SwarmProtocol>(&proto) {
        Ok(p) => p,
        Err(e) => {
            return serde_json::to_string(&CheckResult::ERROR {
                errors: vec![e.to_string()],
            })
            .unwrap()
        }
    };
    let subs = match serde_json::from_str::<Subscriptions>(&subs) {
        Ok(p) => p,
        Err(e) => {
            return serde_json::to_string(&CheckResult::ERROR {
                errors: vec![e.to_string()],
            })
            .unwrap()
        }
    };
    let (graph, _, errors) = swarm::check(proto, &subs);
    if errors.is_empty() {
        serde_json::to_string(&CheckResult::OK).unwrap()
    } else {
        serde_json::to_string(&CheckResult::ERROR {
            errors: errors.map(swarm::Error::convert(&graph)),
        })
        .unwrap()
    }
}

trait MapVec<T> {
    fn map<U>(self, f: impl Fn(T) -> U) -> Vec<U>;
}
impl<T> MapVec<T> for Vec<T> {
    fn map<U>(self, f: impl Fn(T) -> U) -> Vec<U> {
        self.into_iter().map(f).collect()
    }
}
