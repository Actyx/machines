// auto-generated by machine-check, do not edit
import { init } from '@actyx/machine-runner'
init({
  "taxiRide": {
    "entrypoints": [
      {
        "state": "InitialP",
        "role": "P"
      },
      {
        "state": "InitialT",
        "role": "T"
      }
    ],
    "states": {
      "InitialP": {
        "events": {
          "Requested": {
            "moreEvents": [
              "Bid",
              "BidderID"
            ],
            "target": "AuctionP"
          }
        },
        "commands": {
          "Request": {
            "schema": {
              "title": "Request",
              "type": "array",
              "additionalItems": false,
              "items": [
                {
                  "type": "object",
                  "properties": {
                    "pickup": {
                      "type": "string"
                    },
                    "destination": {
                      "type": "string"
                    }
                  },
                  "$schema": "http://json-schema.org/draft-07/schema#",
                  "title": "arg"
                }
              ]
            },
            "events": [
              "Requested"
            ]
          }
        }
      },
      "AuctionP": {
        "events": {
          "Bid": {
            "moreEvents": [
              "BidderID"
            ],
            "target": "AuctionP"
          },
          "Selected": {
            "moreEvents": [
              "PassengerID"
            ],
            "target": "RideP"
          }
        },
        "commands": {
          "Select": {
            "schema": {
              "title": "Select",
              "type": "array",
              "additionalItems": false,
              "items": []
            },
            "events": [
              "Selected",
              "PassengerID"
            ]
          }
        }
      },
      "RideP": {
        "events": {
          "Cancelled": {
            "moreEvents": [],
            "target": "InitialP"
          }
        },
        "commands": {
          "Cancel": {
            "schema": {
              "title": "Cancel",
              "type": "array",
              "additionalItems": false,
              "items": []
            },
            "events": [
              "Cancelled"
            ]
          }
        }
      },
      "InitialT": {
        "events": {
          "Requested": {
            "moreEvents": [],
            "target": "FirstBidT"
          }
        },
        "commands": {}
      },
      "FirstBidT": {
        "events": {
          "Bid": {
            "moreEvents": [
              "BidderID"
            ],
            "target": "AuctionT"
          }
        },
        "commands": {
          "Bid": {
            "schema": {
              "title": "Bid",
              "type": "array",
              "additionalItems": false,
              "items": [
                {
                  "type": "string",
                  "format": "date-time",
                  "$schema": "http://json-schema.org/draft-07/schema#",
                  "title": "time"
                },
                {
                  "type": "number",
                  "$schema": "http://json-schema.org/draft-07/schema#",
                  "title": "price"
                }
              ]
            },
            "events": [
              "Bid",
              "BidderID"
            ]
          }
        }
      },
      "AuctionT": {
        "events": {
          "Bid": {
            "moreEvents": [
              "BidderID"
            ],
            "target": "AuctionT"
          },
          "Selected": {
            "moreEvents": [
              "PassengerID"
            ],
            "target": "RideT"
          }
        },
        "commands": {
          "Bid": {
            "schema": {
              "title": "Bid",
              "type": "array",
              "additionalItems": false,
              "items": [
                {
                  "type": "string",
                  "format": "date-time",
                  "$schema": "http://json-schema.org/draft-07/schema#",
                  "title": "time"
                },
                {
                  "type": "number",
                  "$schema": "http://json-schema.org/draft-07/schema#",
                  "title": "price"
                }
              ]
            },
            "events": [
              "Bid",
              "BidderID"
            ]
          }
        }
      },
      "RideT": {
        "events": {
          "Cancelled": {
            "moreEvents": [],
            "target": "InitialT"
          }
        },
        "commands": {}
      }
    }
  }
})
export { protoUseGeneratedReExportInstead as proto } from '@actyx/machine-runner'