import type { AgAiChatMessage } from "ag-studio";

/**
 * A second conversation with the Exhibit analyst, recorded from a real run on 30 Oct 2026 (GPT-5.6 on Azure OpenAI,
 * the live desk's data, 4 model calls, 80,252 input and 310 output tokens, about $0.10) and saved as it came back.
 * Asked which cases on the seller's move were due within seven days, it read the deadline ladder, cross-filtered the
 * Deadlines page to those cases from the ladder (filter_ladder) and opened the soonest in a new tab (open_case).
 * Loading it makes no model call, and it doesn't re-apply the filter or reopen the tab: those belong to the run.
 */
export const LADDER_RECORDED = "30 Oct 2026";

export const LADDER_THREAD: { title: string; messages: AgAiChatMessage[] } = {
  title: "Recorded 30 Oct 2026: Urgent dispute deadlines (DIX, VXA since filed)",
  messages: [
    {
      "id": "msg-3b04129d-25e5-4ddb-a925-4673743c913e",
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Which cases on my move are due within the next 7 days? Filter the deadline ladder to them, then open the one due soonest."
        }
      ],
      "createdAt": 0
    },
    {
      "id": "call_IlczeH7UGeEf8Cbz7jMzY4Pi",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_IlczeH7UGeEf8Cbz7jMzY4Pi",
            "name": "rename_thread",
            "status": "complete",
            "args": {
              "name": "Urgent dispute deadlines"
            },
            "result": {
              "success": true,
              "response": "Thread renamed to \"Urgent dispute deadlines\".",
              "data": {
                "threadId": "saved-ladder-filter-open",
                "name": "Urgent dispute deadlines"
              }
            }
          }
        }
      ],
      "createdAt": 1
    },
    {
      "id": "call_tf16CV3yCrssdLmU2OC5wFPS",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_tf16CV3yCrssdLmU2OC5wFPS",
            "name": "deadline_ladder",
            "status": "complete",
            "args": {
              "withinDays": 7
            },
            "result": {
              "success": true,
              "response": "2 cases on the seller's move due within 7 days, $316 in all:\nPP-R-DIX-10194390: 6 days left, $180, \"I didn't authorise this, but their own shopping agent bought it\", buyer Imani Clarke, call Fight (evidence balance 85%)\nPP-R-VXA-10194375: 6 days left, $136, \"Not as described: the glaze colour\", buyer Marcus Bell, call Fight (evidence balance 80%)",
              "data": {
                "cases": [
                  "PP-R-DIX-10194390",
                  "PP-R-VXA-10194375"
                ],
                "missed": []
              }
            }
          }
        }
      ],
      "createdAt": 2
    },
    {
      "id": "call_7dNIuTZ03Zk5xg21bF7YmCBS",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_7dNIuTZ03Zk5xg21bF7YmCBS",
            "name": "filter_ladder",
            "status": "complete",
            "args": {
              "caseIds": [
                "PP-R-DIX-10194390",
                "PP-R-VXA-10194375"
              ]
            },
            "result": {
              "success": true,
              "response": "The Deadlines page is cross-filtered from the ladder to PP-R-DIX-10194390, PP-R-VXA-10194375 ($316 between them): the ladder, the stamps, the chart and the case list show only these.",
              "data": {
                "kept": [
                  "PP-R-DIX-10194390",
                  "PP-R-VXA-10194375"
                ],
                "unknown": []
              }
            }
          }
        }
      ],
      "createdAt": 3
    },
    {
      "id": "call_MeTNObldh7gRjWx56nEtGJag",
      "role": "assistant",
      "parts": [
        {
          "type": "tool_call",
          "toolCall": {
            "toolCallId": "call_MeTNObldh7gRjWx56nEtGJag",
            "name": "open_case",
            "status": "complete",
            "args": {
              "caseId": "PP-R-DIX-10194390"
            },
            "result": {
              "success": true,
              "response": "Opened PP-R-DIX-10194390 in a new tab (/case/PP-R-DIX-10194390).",
              "data": {
                "caseId": "PP-R-DIX-10194390",
                "url": "/case/PP-R-DIX-10194390",
                "opened": true
              }
            }
          }
        }
      ],
      "createdAt": 4
    },
    {
      "id": "msg_resp_mvu8cf0u8tagrc_0",
      "role": "assistant",
      "parts": [
        {
          "type": "text",
          "text": "2 cases are due within 7 days, totaling **$316**:\n\n- **PP-R-DIX-10194390** — 6 days left, **$180**\n- **PP-R-VXA-10194375** — 6 days left, **$136**\n\nThe ladder is filtered to both. I opened **PP-R-DIX-10194390**, the first-listed case among the tie for soonest."
        }
      ],
      "createdAt": 5
    }
  ] as unknown as AgAiChatMessage[],
};
