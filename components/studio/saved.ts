import type { AgAiChatMessage, AgWidgetLayoutState } from "ag-studio";

/**
 * One conversation with the Exhibit analyst, recorded from a real run on 29 Oct 2026 (GPT-5.6 on Azure OpenAI, the
 * live desk's data, 14 model calls) and saved as it came back, so the analyst's panel opens on an exchange that built
 * a widget instead of an empty box. Loading it makes no model call. The widget that run built is part of the
 * report the page opens on (report.ts), where the run put it.
 */
export const SAVED_RECORDED = "29 Oct 2026";

export const SAVED_WIDGET: { id: string; widget: unknown; layout: AgWidgetLayoutState } | null = {
  "id": "added-money-by-decider",
  "widget": {
    "type": "bar-chart-stacked",
    "format": {
      "title": {
        "enabled": true,
        "text": "Disputed money by who decided",
        "textAlign": "left"
      },
      "crossFilter": "none"
    },
    "dataMapping": {
      "categoryKey": [
        {
          "id": "cases.decided"
        }
      ],
      "valueKey": [
        {
          "id": "cases.kept",
          "aggregation": "sum"
        },
        {
          "id": "cases.refunded",
          "aggregation": "sum"
        },
        {
          "id": "cases.lostAmount",
          "aggregation": "sum"
        }
      ],
      "tooltipKey": []
    }
  },
  "layout": {
    "xTrack": 0,
    "yTrack": 67,
    "xSpan": 24,
    "ySpan": 16
  }
};

export const SAVED_THREAD: { title: string; messages: AgAiChatMessage[] } | null = {
  title: "Recorded 29 Oct 2026: Money by decision maker",
  messages: [
    {
      "id": "msg-eed60d7f-3ef5-4980-9bcc-b5397472a2f2",
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "On the Money page, add a stacked bar chart of disputed money by who decided: kept, refunded and lost."
        }
      ],
      "createdAt": 0
    },
    {
      "id": "call_m61Xq2ajYs1c6HG86BhTQPrf",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_m61Xq2ajYs1c6HG86BhTQPrf",
            "name": "rename_thread",
            "status": "complete",
            "args": {
              "name": "Money by decision maker"
            },
            "result": {
              "success": true,
              "response": "Thread renamed to \"Money by decision maker\".",
              "data": {
                "threadId": "thread-a09e4dcb-0e6c-48f6-98af-d7e68be3bdcf",
                "name": "Money by decision maker"
              }
            }
          }
        }
      ],
      "createdAt": 1
    },
    {
      "id": "call_c4D3LpFI40SS5Ao634UofyLq",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_c4D3LpFI40SS5Ao634UofyLq",
            "name": "view_schema",
            "status": "complete",
            "args": {},
            "result": {
              "success": true,
              "response": "Cases [cases]\n\tCase [cases.caseId]\n\t\tType: column, Data Type: string\n\tCases [cases.n]\n\t\tType: column, Data Type: number\n\tWhat happened [cases.story]\n\t\tType: column, Data Type: string\n\tReason [cases.reason]\n\t\tType: column, Data Type: string\n\tAmount [cases.amount]\n\t\tType: column, Data Type: number\n\tWhere it stands [cases.stage]\n\t\tType: column, Data Type: string\n\tQueue [cases.queue]\n\t\tType: column, Data Type: string\n\tOutcome [cases.outcome]\n\t\tType: column, Data Type: string\n\tWho decided [cases.decided]\n\t\tType: column, Data Type: string\n\tExhibit's call [cases.call]\n\t\tType: column, Data Type: string\n\tArgued by [cases.engine]\n\t\tType: column, Data Type: string\n\tOdds [cases.odds]\n\t\tType: column, Data Type: number\n\tSentences [cases.sentences]\n\t\tType: column, Data Type: number\n\tStruck [cases.struck]\n\t\tType: column, Data Type: number\n\tWhat was filed [cases.evidenceType]\n\t\tType: column, Data Type: string\n\tBuyer [cases.buyer]\n\t\tType: column, Data Type: string\n\tOpened [cases.opened]\n\t\tType: column, Data Type: date, supportedBuckets: year, quarter, month, week, day, monthOfYear, dayOfWeek\n\tFiled [cases.filed]\n\t\tType: column, Data Type: date, supportedBuckets: year, quarter, month, week, day, monthOfYear, dayOfWeek\n\tDue [cases.due]\n\t\tType: column, Data Type: date, supportedBuckets: year, quarter, month, week, day, monthOfYear, dayOfWeek\n\tDays left [cases.daysLeft]\n\t\tType: column, Data Type: number\n\tKept [cases.kept]\n\t\tType: column, Data Type: number\n\tKept on request [cases.keptAsked]\n\t\tType: column, Data Type: number\n\tKept, sandbox closed it [cases.keptByItself]\n\t\tType: column, Data Type: number\n\tRefunded [cases.refunded]\n\t\tType: column, Data Type: number\n\tLost [cases.lostAmount]\n\t\tType: column, Data Type: number\n\tAt stake [cases.atStake]\n\t\tType: column, Data Type: number\n\tStrike rate [strikeRate]\n\t\tType: measure, Data Type: number, depends: [cases.struck, cases.sentences]\n\tKept share of decided money [keptShare]\n\t\tType: measure, Data Type: number, depends: [cases.kept, cases.refunded, cases.lostAmount]\nBrief sentences [sentences]\n\tCase [sentences.caseId]\n\t\tType: column, Data Type: string\n\tSentences [sentences.n]\n\t\tType: column, Data Type: number\n\tWritten by [sentences.engine]\n\t\tType: column, Data Type: string\n\tChecker's verdict [sentences.kept]\n\t\tType: column, Data Type: string\n\tWhy [sentences.why]\n\t\tType: column, Data Type: string\n\tRecords cited [sentences.cites]\n\t\tType: column, Data Type: number\n\tKept sentences [sentences.keptCount]\n\t\tType: column, Data Type: number\n\tStruck sentences [sentences.struckCount]\n\t\tType: column, Data Type: number\n\tArgued [sentences.argued]\n\t\tType: column, Data Type: date, supportedBuckets: year, quarter, month, week, day, monthOfYear, dayOfWeek",
              "data": {
                "totalFieldsets": 2,
                "totalFields": 37
              }
            }
          }
        }
      ],
      "createdAt": 2
    },
    {
      "id": "call_tZ9wdLFxeU9LNDNYmqZkPZZI",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_tZ9wdLFxeU9LNDNYmqZkPZZI",
            "name": "view_report",
            "status": "complete",
            "args": {},
            "result": {
              "success": true,
              "response": "deadlines (selected): 4 widget(s), 0 page filter(s)\nmoney: 10 widget(s), 0 page filter(s)\nchecker: 7 widget(s), 0 page filter(s)",
              "data": {
                "selectedPageId": "deadlines",
                "pages": [
                  {
                    "pageId": "deadlines",
                    "selected": true,
                    "widgetCount": 4,
                    "widgetTypes": [
                      "exhibit-deadline-ladder",
                      "exhibit-stamps",
                      "column-chart-grouped",
                      "grid"
                    ],
                    "pageFilterCount": 0
                  },
                  {
                    "pageId": "money",
                    "selected": false,
                    "widgetCount": 10,
                    "widgetTypes": [
                      "value",
                      "value",
                      "value",
                      "value",
                      "button-filter",
                      "exhibit-ledger",
                      "column-chart-stacked",
                      "bar-chart-grouped",
                      "exhibit-stamps",
                      "bar-chart-grouped"
                    ],
                    "pageFilterCount": 0
                  },
                  {
                    "pageId": "checker",
                    "selected": false,
                    "widgetCount": 7,
                    "widgetTypes": [
                      "value",
                      "value",
                      "value",
                      "value",
                      "exhibit-checker-strikes",
                      "bar-chart-stacked",
                      "grid"
                    ],
                    "pageFilterCount": 0
                  }
                ]
              }
            }
          }
        }
      ],
      "createdAt": 3
    },
    {
      "id": "call_BUIiWOSpFbK7GZ9DZ7ZTwI3T",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_BUIiWOSpFbK7GZ9DZ7ZTwI3T",
            "name": "new_widget_slot",
            "status": "complete",
            "args": {
              "page": "money",
              "name": "money by decider",
              "xSpan": 24,
              "ySpan": 16
            },
            "result": {
              "success": true,
              "response": "New widget id \"added-money-by-decider\" on page \"money\", free at xTrack 0, yTrack 67, xSpan 24, ySpan 16 (below everything already there). Tell the page agent to add_widget with exactly this id and position, and not to reuse any existing widget.",
              "data": {
                "widgetId": "added-money-by-decider",
                "pageId": "money",
                "xTrack": 0,
                "yTrack": 67,
                "xSpan": 24,
                "ySpan": 16
              }
            }
          }
        }
      ],
      "createdAt": 4
    },
    {
      "id": "call_elsJFpMxE97jg3vMSTr2sNbw",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_elsJFpMxE97jg3vMSTr2sNbw",
            "name": "delegate_to",
            "status": "complete",
            "args": {
              "type": {
                "id": "page",
                "pageId": "money"
              },
              "instructions": "Add a new widget; do not reuse or change any existing widget. Use widgetId added-money-by-decider, widgetType bar-chart-stacked, at xTrack 0, yTrack 67, xSpan 24, ySpan 16."
            },
            "childThreadId": "call_elsJFpMxE97jg3vMSTr2sNbw-sub",
            "result": {
              "success": true,
              "response": "On page money, added new @widget[added-money-by-decider] as a stacked bar chart at xTrack 0, yTrack 67, xSpan 24, ySpan 16. No existing widgets were changed or reused, and the verified layout reports no issues."
            }
          }
        }
      ],
      "createdAt": 5
    },
    {
      "id": "call_kGmxOtS1wfIOuHVPgPvZlH0y",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_kGmxOtS1wfIOuHVPgPvZlH0y",
            "name": "delegate_to",
            "status": "complete",
            "args": {
              "type": {
                "id": "widget",
                "widgetType": "bar-chart-stacked",
                "widgetId": "added-money-by-decider",
                "pageId": "money"
              },
              "instructions": "Configure the new stacked bar chart to show disputed money grouped by Who decided (cases.decided), with stacked series Kept (sum cases.kept), Refunded (sum cases.refunded), and Lost (sum cases.lostAmount). Title it “Disputed money by who decided”. Format values as USD. Do not change any other widget."
            },
            "childThreadId": "call_kGmxOtS1wfIOuHVPgPvZlH0y-sub",
            "result": {
              "success": true,
              "response": "Configured `added-money-by-decider` as a stacked horizontal bar chart titled “Disputed money by who decided,” grouped by @field[cases.decided] with summed @field[cases.kept], @field[cases.refunded], and @field[cases.lostAmount]. Monetary fields use the dashboard’s USD semantics."
            }
          }
        }
      ],
      "createdAt": 6
    },
    {
      "id": "call_v6X205KhrRvZRRW5cUFBnahh",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_v6X205KhrRvZRRW5cUFBnahh",
            "name": "check_widget",
            "status": "complete",
            "args": {
              "page": "money",
              "widgetId": "added-money-by-decider"
            },
            "result": {
              "success": true,
              "response": "Confirmed: added-money-by-decider is on page \"money\" as a bar-chart-stacked titled \"Disputed money by who decided\" at row 67, 24 of 24 tracks wide. No widget that was already there changed.",
              "data": {
                "found": true,
                "changed": [],
                "removed": []
              }
            }
          }
        }
      ],
      "createdAt": 7
    },
    {
      "id": "call_Ky8RZSe7TS40aNY4LfLQsLTa",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_Ky8RZSe7TS40aNY4LfLQsLTa",
            "name": "turn_to_page",
            "status": "complete",
            "args": {
              "page": "money"
            },
            "result": {
              "success": true,
              "response": "Now showing the Money page."
            }
          }
        }
      ],
      "createdAt": 8
    },
    {
      "id": "msg_resp_mvu07ri3hh1kyr_0",
      "role": "assistant",
      "parts": [
        {
          "type": "text",
          "text": "Added and confirmed on the Money page: **“Disputed money by who decided”**, a stacked bar chart showing kept, refunded, and lost dollars. No existing widgets changed."
        }
      ],
      "createdAt": 9
    }
  ] as unknown as AgAiChatMessage[],
};
