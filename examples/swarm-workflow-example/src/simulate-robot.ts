import { Actyx } from "@actyx/sdk";
import { dockAndDrawWater } from "./consumers/watering-robot";
import { requestDocking } from "./machines/signaling";
import * as uuid from "uuid";

async function main() {
  console.log("robot started");

  const APP_MANIFEST = {
    appId: "com.example.tomato-robot",
    displayName: "Tomato Robot",
    version: "1.0.0",
  };

  const sdk = await Actyx.of(APP_MANIFEST);

  while (true) {
    // randomize which robots issue docking request first
    await sleep(Math.round(Math.random() * 1000));
    const dockingId = await requestDocking(sdk);
    console.log(`dockingId issued`, dockingId);
    await dockAndDrawWater(sdk, dockingId);
  }
}

const sleep = (dur: number) => new Promise((res) => setTimeout(res, dur));

// Monkey patch console log
// So that it is easier to read
const agentId = uuid.v4();
const originalConsoleLog = console.log;
const patchedConsoleLog = (...x: string[]) => originalConsoleLog(`robot:${agentId} :`, ...x);
console.log = patchedConsoleLog;

main();
