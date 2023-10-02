import { Actyx, AqlEventMessage, Tag } from "@actyx/sdk";
import * as uuid from "uuid";

type Payload = string;

const REQUEST_TAG = "water-drawing-exchange-request";

export const requestDocking = async (actyx: Actyx) => {
  // The payload
  const dockingId: Payload = uuid.v4();
  await actyx.publish(Tag(REQUEST_TAG).apply(dockingId));
  return dockingId;
};

const AQL = `
PRAGMA features := subQuery interpolation
FROM "${REQUEST_TAG}"
LET done_events := FROM \`water-drawing-exchange:{_}\` FILTER _.type = 'RobotIsUndocked' LIMIT 1 END
FILTER !IsDefined(done_events[0] ?? null)
`.trim();

export const receiveDockingRequestId = async (actyx: Actyx): Promise<string | undefined> =>
  (await actyx.queryAql(AQL))
    .filter((msg): msg is AqlEventMessage => msg.type === "event")
    .map((msg) => msg.payload as Payload)
    .at(0);
