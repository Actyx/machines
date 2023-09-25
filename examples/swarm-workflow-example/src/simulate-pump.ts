import { Actyx } from "@actyx/sdk";
import { supplyWater } from "./consumers/water-pump";
import { receiveDockingRequestId } from "./machines/signaling";

async function main() {
  const APP_MANIFEST = {
    appId: "com.example.tomato-robot",
    displayName: "Tomato Robot",
    version: "1.0.0",
  };

  const sdk = await Actyx.of(APP_MANIFEST);

  while (true) {
    const dockingId = await receiveDockingRequestId(sdk);
    if (!dockingId) {
      console.log("no dockingId found");
      await sleep(1000);
      continue;
    }
    console.log(`dockingId found: ${dockingId}`);
    await supplyWater(sdk, dockingId);
  }
}

const sleep = (dur: number) => new Promise((res) => setTimeout(res, dur));

// Monkey patch console log
// So that it is easier to read
const originalConsoleLog = console.log;
const patchedConsoleLog = (...x: string[]) => originalConsoleLog(`pump :`, ...x);
console.log = patchedConsoleLog;

main();
