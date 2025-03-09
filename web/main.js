import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui-js";
import { Buffer } from "buffer";
import {
  nearAiChatCompletionRequest,
  sendStreamingRequest,
} from "./openai/chat-completion.js";
import {
  tools,
  toolImplementations,
  setWalletSelector,
} from "./openai/tools.js";
import { marked } from "marked";
import {
  handleNearAILoginCallback,
  nearAIlogin,
  NEAR_AI_AUTH_OBJECT_STORAGE_KEY,
} from "./nearai/login.js";
import { getProgressBarHTML } from "./ui/progress-bar.js";

window.Buffer = Buffer;

let setupLedger;
const walletSelectorModules = [setupMyNearWallet()];
try {
  setupLedger = (await import("@near-wallet-selector/ledger")).setupLedger;
  walletSelectorModules.push(setupLedger());
} catch (e) {
  console.warn("not able to setup ledger", e);
}

const walletSelector = await setupWalletSelector({
  network: "testnet",
  modules: walletSelectorModules,
});
window.walletSelector = walletSelector;

setWalletSelector(walletSelector);

const walletSelectorModal = setupModal(walletSelector, {
  contractId: localStorage.getItem("contractId"),
  methodNames: ["call_js_func"],
});

document
  .getElementById("openWalletSelectorButton")
  .addEventListener("click", () => walletSelectorModal.show());

const baseUrl = "http://127.0.0.1:3000";
const proxyUrl = `${baseUrl}/proxy`;
let conversation = [
  { role: "system", content: "You are a helpful assistant." },
];

const progressModalElement = document.getElementById("progressmodal");
const progressModal = new bootstrap.Modal(progressModalElement);

function setProgressModalText(progressModalText) {
  document.getElementById("progressModalLabel").innerHTML = progressModalText;
  document.getElementById("progressbar").style.display = null;
  document.getElementById("progressErrorAlert").style.display = "none";
  document.getElementById("progressErrorAlert").innerText = "";
}

function setProgressErrorText(progressErrorText) {
  document.getElementById("progressModalLabel").innerHTML = "Error";
  document.getElementById("progressbar").style.display = "none";
  document.getElementById("progressErrorAlert").style.display = "block";
  document.getElementById("progressErrorAlert").innerText = progressErrorText;
}

async function startAiProxyConversation() {
  try {
    setProgressModalText("Starting conversation via AI proxy");
    progressModal.show();
    const selectedWallet = await walletSelector.wallet();

    const account = (await selectedWallet.getAccounts())[0];

    const conversation_id = `${account.accountId}_${new Date().getTime()}`;
    const conversation_id_hash = Array.from(
      new Uint8Array(
        await window.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(conversation_id),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await selectedWallet.signAndSendTransaction({
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "call_js_func",
            args: {
              function_name: "start_ai_conversation",
              conversation_id: conversation_id_hash,
            },
            gas: "30000000000000",
            deposit: "0",
          },
        },
      ],
    });

    const transactionStatus = await fetch("http://localhost:14500", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "dontcare",
        method: "tx",
        params: {
          tx_hash: result.transaction.hash,
          sender_account_id: account.accountId,
          wait_until: "FINAL",
        },
      }),
    }).then((r) => r.json());

    if (!transactionStatus.result.final_execution_status === "FINAL") {
      throw new Error(
        `Unable to query start converstation transaction status ${JSON.stringify(transactionStatus)}`,
      );
    }
    localStorage.setItem("conversation_id", conversation_id);
    progressModal.hide();
    return conversation_id;
  } catch (e) {
    setProgressErrorText(e);
  }
}

function checkExistingConversationId() {
  const existingConversationId = localStorage.getItem("conversation_id");
  return existingConversationId;
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const askAIButton = document.getElementById("askAIButton");
askAIButton.addEventListener("click", async () => {
  const conversation_id = `demo_${new Date().getTime()}`;

  const question = document.getElementById("question").value;
  const messagesDiv = document.getElementById("messages");
  document.getElementById("question").value = "";

  conversation.push({ role: "user", content: question });
  messagesDiv.innerHTML += `<strong>User:</strong> ${escapeHtml(question)}<br>`;

  askAIButton.disabled = true;
  try {
    let assistantResponseElement = document.createElement("div");
    assistantResponseElement.innerHTML = getProgressBarHTML();
    messagesDiv.appendChild(assistantResponseElement);

    const response = await fetch("http://127.0.0.1:3000/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    let assistantResponse = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      console.log("Raw chunk received:", chunk);

      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.substring(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            console.log("Parsed data:", parsed);

            if (parsed.choices &&
                parsed.choices.length > 0 &&
                parsed.choices[0].delta &&
                parsed.choices[0].delta.content) {

              assistantResponse += parsed.choices[0].delta.content;
              assistantResponseElement.innerHTML = `<strong>Assistant:</strong> ${marked.parse(assistantResponse)}`;
            }
            else if (parsed.choices &&
                    parsed.choices.length > 0 &&
                    parsed.choices[0].message &&
                    parsed.choices[0].message.content) {

              assistantResponse = parsed.choices[0].message.content;
              assistantResponseElement.innerHTML = `<strong>Assistant:</strong> ${marked.parse(assistantResponse)}`;
              break;
            }
          } catch (e) {
            console.error("Error parsing JSON:", e, "Raw data:", data);
          }
        }
      }
    }

    conversation.push({ role: "assistant", content: assistantResponse });

  } catch (error) {
    console.error(error);
    messagesDiv.innerHTML += `<strong>Assistant:</strong> Error: ${error.message}<br>`;
  }
  askAIButton.disabled = false;
});

const askNearAIButton = document.getElementById("askNearAIButton");
askNearAIButton.addEventListener("click", async () => {
  const auth = localStorage.getItem(NEAR_AI_AUTH_OBJECT_STORAGE_KEY);
  if (auth === null) {
    try {
      await nearAIlogin(await walletSelector.wallet(), "Login to NEAR AI");
    } catch (e) {
      progressModal.show();
      setProgressErrorText(e);
      return;
    }
  }
  const question = document.getElementById("question").value;
  const messagesDiv = document.getElementById("messages");
  document.getElementById("question").value = ""; // Clear input field

  // Add user question to the conversation
  conversation.push({ role: "user", content: question });
  messagesDiv.innerHTML += `<strong>User:</strong> ${escapeHtml(question)}<br>`;

  const messages = conversation;

  askNearAIButton.disabled = true;
  try {
    // Add placeholder for the assistant's response
    let assistantResponseElement = document.createElement("div");
    assistantResponseElement.innerHTML = getProgressBarHTML();
    messagesDiv.appendChild(assistantResponseElement);

    const authorizationObject = JSON.parse(auth);
    // Fetch the proxy endpoint with a POST request
    const newMessages = await nearAiChatCompletionRequest({
      authorizationObject: authorizationObject,
      proxyUrl,
      messages,
      tools,
      toolImplementations,
      onError: (err) => {
        messagesDiv.innerHTML += `<strong>Assistant:</strong> Failed to fetch from proxy: ${err.statusText} ${err.responText ?? ""} <br>`;
      },
      onChunk: (chunk) => {
        assistantResponseElement.innerHTML = `<strong>Assistant:</strong> ${marked(chunk.assistantResponse)}`;
      },
    });

    if (newMessages) {
      conversation = newMessages;
    }
    console.log(conversation);
  } catch (error) {
    console.error(error);
    messagesDiv.innerHTML += "<strong>Assistant:</strong> " + error + "<br>";
  }
  askNearAIButton.disabled = false;
});

handleNearAILoginCallback();
askAIButton.disabled = false;
askNearAIButton.disabled = false;
