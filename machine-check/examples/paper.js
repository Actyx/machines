import { checkSwarmProtocol, checkProjection } from '../lib/index.js'

// prettier-ignore
const swarm = {
  initial: 'S0',
  transitions: [
    { source: 'S0', target: 'S1', label: { role: 'P', cmd: 'Request', logType: ['Requested'] } },
    { source: 'S1', target: 'S2', label: { role: 'T', cmd: 'Offer', logType: ['Bid', 'BidderID'] } },
    { source: 'S2', target: 'S2', label: { role: 'T', cmd: 'Offer', logType: ['Bid', 'BidderID'] } },
    { source: 'S2', target: 'S3', label: { role: 'P', cmd: 'Select', logType: ['Selected', 'PassengerID'] } },
    { source: 'S3', target: 'S6', label: { role: 'P', cmd: 'Cancel', logType: ['Cancelled'] } },
    { source: 'S3', target: 'S4', label: { role: 'T', cmd: 'Arrive', logType: ['Arrived'] } },
    { source: 'S4', target: 'S5', label: { role: 'P', cmd: 'Start', logType: ['Started'] } },
    { source: 'S5', target: 'S5', label: { role: 'T', cmd: 'Record', logType: ['Path'] } },
    { source: 'S5', target: 'S6', label: { role: 'P', cmd: 'Finish', logType: ['Finished', 'Rating'] } },
    { source: 'S6', target: 'S7', label: { role: 'O', cmd: 'Receipt', logType: ['Receipt'] } },
  ],
}

// prettier-ignore
const subscription = {
  P: [ 'Requested', 'Bid', 'BidderID', 'Selected', 'PassengerID', 'Cancelled', 'Arrived', 'Started', 'Path', 'Finished', 'Receipt', ],
  T: [ 'Requested', 'Bid', 'BidderID', 'Selected', 'PassengerID', 'Cancelled', 'Arrived', 'Started', 'Path', 'Finished', 'Receipt', ],
  O: [ 'Requested', 'Bid', 'Selected', 'Cancelled', 'Arrived', 'Started', 'Path', 'Finished', 'Receipt', ],
}

// prettier-ignore
const P = {
  initial: 'S0',
  transitions: [
    { source: 'S0', target: 'S0', label: { tag: 'Execute', cmd: 'Request', logType: ['Requested'] } },
    { source: 'S0', target: 'S1', label: { tag: 'Input', eventType: 'Requested' } },
    { source: 'S1', target: 'S2', label: { tag: 'Input', eventType: 'Bid' } },
    { source: 'S2', target: 'S3', label: { tag: 'Input', eventType: 'BidderID' } },
    { source: 'S3', target: 'S3', label: { tag: 'Execute', cmd: 'Select', logType: ['Selected', 'PassengerID'] } },
    { source: 'S3', target: 'S4', label: { tag: 'Input', eventType: 'Bid' } },
    { source: 'S4', target: 'S3', label: { tag: 'Input', eventType: 'BidderID' } },
    { source: 'S3', target: 'S5', label: { tag: 'Input', eventType: 'Selected' } },
    { source: 'S5', target: 'S6', label: { tag: 'Input', eventType: 'PassengerID' } },
    { source: 'S6', target: 'S6', label: { tag: 'Execute', cmd: 'Cancel', logType: ['Cancelled'] } },
    { source: 'S6', target: 'S7', label: { tag: 'Input', eventType: 'Cancelled' } },
    { source: 'S6', target: 'S8', label: { tag: 'Input', eventType: 'Arrived' } },
    { source: 'S8', target: 'S8', label: { tag: 'Execute', cmd: 'Start', logType: ['Started'] } },
    { source: 'S8', target: 'S9', label: { tag: 'Input', eventType: 'Started' } },
    { source: 'S9', target: 'S9', label: { tag: 'Input', eventType: 'Path' } },
    { source: 'S9', target: 'S9', label: { tag: 'Execute', cmd: 'Finish', logType: ['Finished', 'Rating'] } },
    { source: 'S9', target: 'S7', label: { tag: 'Input', eventType: 'Finished' } },
    { source: 'S7', target: 'S10', label: { tag: 'Input', eventType: 'Receipt' } },
  ],
}

console.log(checkSwarmProtocol(swarm, subscription))
console.log(checkProjection(swarm, subscription, 'P', P))
