function sha256(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function start_ai_conversation() {
  const amount = 200_000_000n;
  const { conversation_id } = JSON.parse(env.input());
  if (!conversation_id) {
    env.panic(`must provide conversation_id`);
    return;
  }
  
  const hashed_id = conversation_id;
  
  const existing_conversation = env.get_data(hashed_id);
  if (existing_conversation) {
    env.panic(`conversation already exist`);
    return;
  }
  
  env.set_data(
    hashed_id,
    JSON.stringify({
      receiver_id: env.signer_account_id(),
      amount: amount.toString(),
    }),
  );
  
  env.ft_transfer_internal(
    env.signer_account_id(),
    env.current_account_id(),
    amount.toString(),
  );
  
  env.value_return(hashed_id);
}

export function view_ai_conversation() {
  const { conversation_id } = JSON.parse(env.input());
  env.value_return(env.get_data(conversation_id));
}

export function refund_unspent() {
  const { refund_message, signature } = JSON.parse(env.input());
  const public_key = new Uint8Array([211,204,160,145,102,174,54,214,18,83,210,237,37,147,217,197,222,229,218,172,137,0,97,167,145,138,150,234,130,12,0,112]);

  const signature_is_valid = env.ed25519_verify(
    new Uint8Array(signature),
    new Uint8Array(env.sha256_utf8(refund_message)),
    public_key,
  );

  if (signature_is_valid) {
    const { receiver_id, refund_amount, conversation_id } =
      JSON.parse(refund_message);

    const conversation_data = JSON.parse(env.get_data(conversation_id));

    if (BigInt(conversation_data.amount) >= BigInt(refund_amount)) {
      env.clear_data(conversation_id);
      env.ft_transfer_internal(
        env.current_account_id(),
        receiver_id,
        refund_amount,
      );
      print(`refunded ${refund_amount} to ${receiver_id}`);
    }
  } else {
    env.panic("Invalid signature");
  }
}

export function buy_tokens_for_near() {
  if (env.attached_deposit() === 500_000_000_000_000_000_000_000n.toString()) {
    env.ft_transfer_internal(
      env.current_account_id(),
      env.predecessor_account_id(),
      3_000_000n.toString(),
    );
  } else {
    env.panic("Must attach 0.5 NEAR to get 3 tokens");
  }
}
