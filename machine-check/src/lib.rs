use std::collections::{BTreeMap, BTreeSet};
use wasm_bindgen::prelude::*;

mod machine;
mod swarm;
pub mod types;

use types::{CheckResult, EventType, MachineLabel, Protocol, Role, SwarmLabel};

pub type Subscriptions = BTreeMap<Role, BTreeSet<EventType>>;
pub type SwarmProtocol = Protocol<SwarmLabel>;
pub type Machine = Protocol<MachineLabel>;

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
    match swarm::check(proto, subs) {
        Ok(_) => serde_json::to_string(&CheckResult::OK).unwrap(),
        Err(errors) => serde_json::to_string(&CheckResult::ERROR { errors }).unwrap(),
    }
}
