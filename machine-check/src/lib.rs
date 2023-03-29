use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum CheckResult {
    OK,
    ERROR { errors: Vec<String> },
}

#[wasm_bindgen]
pub fn check(ps: String) -> String {
    serde_json::to_string(&CheckResult::OK).unwrap()
}
