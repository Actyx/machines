use intern_arc::{global::hash_interner, InternedHash};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::{self, Display},
    ops::Deref,
};
use wasm_bindgen::prelude::*;

mod swarm;

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum CheckResult {
    OK,
    ERROR { errors: Vec<String> },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Protocol<L> {
    initial: String,
    transitions: Vec<Transition<L>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Transition<L> {
    label: L,
    source: String,
    target: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct SwarmLabel {
    cmd: String,
    log_type: Vec<String>,
    role: String,
}

impl fmt::Display for SwarmLabel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}@{}<", self.cmd, self.role)?;
        for (i, t) in self.log_type.iter().enumerate() {
            if i > 0 {
                write!(f, ",")?;
            }
            write!(f, "{}", t)?;
        }
        write!(f, ">")
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "tag")]
pub enum MachineLabel {
    #[serde(rename_all = "camelCase")]
    Execute { cmd: String, log_type: Vec<String> },
    #[serde(rename_all = "camelCase")]
    Input { event_type: String },
}

pub type Subscriptions = BTreeMap<String, BTreeSet<String>>;
pub type SwarmProtocol = Protocol<SwarmLabel>;
pub type Machine = Protocol<MachineLabel>;

#[derive(Clone, Debug, PartialEq, PartialOrd, Ord, Eq)]
struct Role(InternedHash<str>);

impl Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl Role {
    pub fn new(name: &str) -> Self {
        Self(hash_interner().intern_ref(name))
    }
}

impl Deref for Role {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}

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
