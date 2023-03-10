/**
 * RK: draft of an approach for the logistician as an example
 *
 * Lots of details are missing. The general principle is that the logistician runs two concurrent loops:
 * - one executing accepted transport orders
 * - one selecting/creating transport orders
 *
 * The two loops depend on each other: the first needs to wait for a transport order to be reserved, the
 * second needs to wait for a reserved order to be started before working on reserving the next one.
 *
 * The logistician keeps track of what it was doing by emitting an event stream that is intended to
 * be consumed using AQL queries (not fishes or machines) because it is long-running.
 *
 * The process for reserving a single transport order is modelled by a machine and the result is that the
 * order proceeds to the reserved state.
 *
 * The transport order has a well-defined lifecycle that is modelled by its own machine. The logistician
 * uses AQL to find all created but not yet reserved orders, inspects them for compatibility, and bids
 * for a matching one.
 */
// mock of successor of Pond.observe() API
const runMachine = (
  _a: Actyx,
  _tags: Where<any>,
  _initial: any,
  _cb: (s: any) => void
) => void 0;
type Machine = AsyncGenerator<any, void, "stop" | "current" | undefined>;
const runMachineStream = async function* <E>(
  _a: Actyx,
  _tags: Where<E>,
  _initial: any
): Machine {};
const machines = undefined as any;
type Match = {
  match(state: any, fn: (...a: any[]) => void): Match;
  otherwise(fn: (state: any) => void): void;
};
const MachineMatcher: { init(a: any): Match } = undefined as any;

type LogisticianEvent =
  | { type: "reservationRequested"; reserved: string }
  | { type: "reserved"; reserved: string }
  | { type: "reservationLost"; reserved: string }
  | { type: "missionStarted"; mission: string }
  | { type: "missionCompleted"; mission: string };
const logisticianTag = Tag<LogisticianEvent>("logistician");

const logistician = async (actyx: Actyx, assetId: string) => {
  let currentMission: string | null = null;
  let currentReservation: Machine | null = null;

  const m2r = new Channel(0);
  const r2m = new Channel<Machine>(0);

  const myTag = logisticianTag.withId(assetId);

  // get latest state
  const startingPoint = await actyx.queryAql({
    query: `
        FROM ${myTag}
        AGGREGATE {
            reservation: LAST({ type: _.type, reserved: _.reserved }) ?? NULL -- skips mission events
            mission: LAST({ type: _.type, mission: _.mission }) ?? NULL -- skips reservation events
        }`,
  });
  // The result normally contains an AqlEventMsg followed by an AqlOffsetMsg; prod code should check this
  if (startingPoint[0].type === "event") {
    const { reservation, mission } = startingPoint[0].payload as {
      reservation: { type: string; reserved: string };
      mission: { type: string; mission: string };
    };
    if (mission.type === "missionStarted") currentMission = mission.mission;
    if (reservation.type === "reservationRequested") {
      const LO = machines.LogisticOrder;
      currentReservation = runMachineStream(
        actyx,
        Tag(`logisticOrder:${reservation.reserved}`),
        LO
      );
    }
  } else {
    throw new Error("can’t get state");
  }

  const picker = async (): Promise<unknown> => {
    const LO = machines.LogisticOrder;

    // step 1: figure out which reservation process to participate in
    if (currentReservation === null) {
      // the reasoning here is that logisticOrders are only relevant for a short time
      // since requesters will need to apply timeouts anyway, so just look into the
      // last 24h (might even be shorter)
      //
      // orders may also be tagged with the AGV type to only check relevant ones
      const orderIDs = (
        await actyx.queryAql({
          query: `
                    FROM 'logisticOrder' & 'created' & TIME ≥ 1D ago
                    FILTER !IsDefined((FROM \`logisticOrder:{_.id}\` & 'reserved')[0])
                    SELECT _.id
                `,
        })
      )
        .filter((msg): msg is AqlEventMessage => msg.type === "event")
        .map((msg) => msg.payload as string);
      // orderIDs are sorted by creation time, ascending (logical timestamp), so pick the first that fits
      for (const orderId of orderIDs) {
        const machine = runMachineStream(
          actyx,
          Tag(`logisticOrder:${orderId}`),
          LO
        );
        const { value: state } = await machine.next();
        const order = MachineMatcher.init(state)
          .match(LO.Idle, (state) => state.order)
          .match(LO.Requested, (state) => state.order)
          .otherwise(() => null);
        if (order !== null && isOrderAppropriateForMe(order)) {
          currentReservation = machine;
          break;
        }
        machine.next("stop"); // important: release resources!
      }
      return setTimeout(picker, currentReservation === null ? 1000 : 0);
    }

    // step 2: follow the reservation protocol
    const cr = currentReservation;
    MachineMatcher.init(await currentReservation.next("current"))
      .match(LO.Idle, (state) => state.commands.request(assetId))
      .match(
        LO.Requested,
        (state) =>
          state.self.requests.contains(assetId) ||
          state.commands.request(assetId)
      )
      .match(LO.AwaitAccept, async (state) => {
        if (state.self.winner === assetId) {
          // first note down what we’re doing (so we can restart from here)
          await actyx.publish(
            myTag.apply({ type: "reserved", reserved: state.id })
          );
          await state.commands.accept(); // then tell the rest of the fleet about it
          await r2m.send(cr).sync(); // wait for transport loop to pick it up
          currentReservation = null; // and start looking for the next mission
        } else {
          currentReservation = null; // we lost
        }
      })
      .otherwise((_state) => (currentReservation = null)); // someone else proceeded already

    if (currentReservation !== null) await currentReservation.next();
    setTimeout(picker, 0); // trampoline via the node.js event loop
  };

  const transporter = async (
    currentMission: Machine | null = null
  ): Promise<void> => {
    // step 1: wait for reserved mission
    if (currentMission === null) {
      const m = await r2m.receive().sync();
      if (m.isNone()) throw new Error("unexpected None from picker");
      currentMission = m.value;
    }

    // step 2: execute the mission
    for await (const state of currentMission) {
      // the idea here is that if we come back to a stale mission (after a restart)
      // then we’ll find the mission (logisticOrder) cancelled; the manager will
      // create a new one for the same transport and thus start a new auction
      const todo = await MachineMatcher.init(state)
        .match(LO.AwaitStart, (state) => state.commands.start())
        .match(LO.InWork, async (state) => {
          const origin = await conn.navigation.getLocationForName(state.origin);
          await conn.movement.moveToNode(origin);
          // missing here: run handshake (async function)
          // BTW: “unload” in English also means “from the AGV”, perhaps better “take” (and “put” below)
          await conn.workpieceMovement.unload();
          const destination = await conn.navigation.getLocationForName(
            state.destination
          );
          await conn.movement.moveToNode(destination);
          // missing here: run handshake (async function)
          await conn.workpieceMovement.load();

          await state.commands.done();
          return "break";
        })
        .otherwise(() => "break");
      if (todo === "break") {
        break;
      }
    }

    // step 3: wait for next reserved mission
    setTimeout(transporter, 0);
  };
};

function isOrderAppropriateForMe(o: any): boolean {
  return true;
}
