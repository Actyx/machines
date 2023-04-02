import { checkSwarmProtocol, checkProjection } from '../lib/index.js'

// prettier-ignore
const swarm = {
  initial: 'S0',
  transitions: [
    { label: { cmd: 'Request', logType: ['Requested'], role: 'P', }, source: 'S0', target: 'S1', },
    { label: { cmd: 'Offer', logType: ['Bid', 'BidderID'], role: 'T', }, source: 'S1', target: 'S2', },
    { label: { cmd: 'Offer', logType: ['Bid', 'BidderID'], role: 'T', }, source: 'S2', target: 'S2', },
    { label: { cmd: 'Select', logType: ['Selected', 'PassengerID'], role: 'P', }, source: 'S2', target: 'S3', },
    { label: { cmd: 'Cancel', logType: ['Cancelled'], role: 'P', }, source: 'S3', target: 'S6', },
    { label: { cmd: 'Arrive', logType: ['Arrived'], role: 'T', }, source: 'S3', target: 'S4', },
    { label: { cmd: 'Start', logType: ['Started'], role: 'P', }, source: 'S4', target: 'S5', },
    { label: { cmd: 'Record', logType: ['Path'], role: 'T', }, source: 'S5', target: 'S5', },
    { label: { cmd: 'Finish', logType: ['Finished', 'Rating'], role: 'P', }, source: 'S5', target: 'S6', },
    { label: { cmd: 'Receipt', logType: ['Receipt'], role: 'O', }, source: 'S6', target: 'S7', },
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
    { source: 'S0', target: 'S0', label: { tag: 'Execute', cmd: 'Request', logType: ['Requested'] }, },
    { source: 'S0', target: 'S1', label: { tag: 'Input', eventType: 'Requested' } },
    { source: 'S1', target: 'S2', label: { tag: 'Input', eventType: 'Bid' } },
    { source: 'S2', target: 'S3', label: { tag: 'Input', eventType: 'BidderID' } },
    { source: 'S3', target: 'S3', label: { tag: 'Execute', cmd: 'Select', logType: ['Selected'] } },
  ],
}

console.log(checkSwarmProtocol(swarm, subscription))
console.log(checkProjection(swarm, subscription, 'P', P))
