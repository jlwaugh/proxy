## GUIDE
### How to deploy a web4 contract with JavaScript:
> based on [this example](https://github.com/petersalomonsen/quickjs-rust-near/tree/main/examples/aiproxy) from `quickjs-rust-near`

#### 1. Deploy Initial Contract
First, download and unzip `example_contracts` from here:
https://github.com/petersalomonsen/quickjs-rust-near/releases/tag/v0.0.4

Then, via CLI, navigate to the unzipped folder and run these commands:
```bash
near login
```

BEWARE - This costs about 9 NEAR!
```bash
near deploy <account_id> minimum_web4.wasm
```

*NOTE - We don't recommend using a subaccount because it won’t work with the hosted web4 page setup.*

#### 2. Prepare JavaScript File
Clone this repo:
```bash
git clone https://github.com/jlwaugh/proxy.git && cd proxy
```

Save `aiconversation.js` in a temporary environment variable:
```bash
export JSON_ARGS=$(cat ./aiconversation.js | jq -Rs '{javascript: .}')
```

##### MINIMUM VIABLE SCRIPT
```javascript
export function web4_get() {
    env.value_return(JSON.stringify({
        contentType: "text/html; charset=UTF-8",
        body: env.base64_encode("Hello")
  	}));
}
```

#### 3. Post the JavaScript
Call `post_javascript` to put your JavaScript in the contract with a `web4_get` method implemented.

```bash
near contract call-function as-transaction <account_id> post_javascript json-args $JSON_ARGS prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as <account_id> network-config testnet sign-with-keychain send
```

#### 4. Build WASM Container App
This folder contains a [Spin](https://www.fermyon.com/spin) application, based on the WASI 2 and the [WebAssembly Component Model](https://component-model.bytecodealliance.org). It is implemented in Rust as a serverless proxy for the OpenAI API.

There is a simple example of a web client in the [web](./web/) folder.

Before launching, you will need to install the Spin SDK.

##### via Fermyon Installer
```bash
curl -fsSL https://developer.fermyon.com/downloads/install.sh | bash
```

##### via Homebrew (macOS/Linux)
```bash
brew install spin
```

Then run the following commands:
```bash
spin build
```
```bash
spin up
```

This will start the LLM proxy server at: http://localhost:3000

#### 5. Deploy

The easiest approach is to deploy to the [Fermyon Cloud](https://www.fermyon.com/cloud).

Create an account [here](https://cloud.fermyon.com), if you don't already have one.

Install the Fermyon Cloud plugin for Spin:
```bash
spin plugin install cloud
```

Authenticate with your new Fermyon account:
```bash
spin cloud login
```
Follow the browser prompts to complete authentication.

Deploy the app:
```bash
spin cloud deploy --variable api_key=<your OpenAI API key goes here> --variable rpc_url=https://rpc.testnet.near.org
```
This will generate a hosted instance of the LLM proxy.

#### 6. Update JavaScript
Once you get the URL of your deployed Spin app, update line 25 of `aiconversation.js`:

BEFORE
```javascript
const baseUrl = "http://localhost:3000";
```

AFTER
```javascript
const baseUrl = "<your fermyon url goes here>";
```

#### 7. Post Updated JavaScript
Next, prepare `JSON_ARGS`:
```bash
export JSON_ARGS=$(cat ./aiconversation.js | jq -Rs '{javascript: .}')
```

Finally, call `post_javascript` again to update what's inside the contract:
```bash
near contract call-function as-transaction <account_id> post_javascript json-args $JSON_ARGS prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as <account_id> network-config testnet sign-with-keychain send
```

Now you should be able to use it on your web4 page:
> Testnet: https://<account_id>.testnet.page
> Mainnet: https://<account_id>.near.page

Let us know any feedback ☺️
