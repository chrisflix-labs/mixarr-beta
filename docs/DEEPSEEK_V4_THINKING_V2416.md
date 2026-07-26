# DeepSeek V4 thinking (v2.4.16 historical note)

Mixarr v2.4.16 introduced explicit DeepSeek thinking controls and separated final `message.content` from private `reasoning_content`.

The provider-test output allowance described in the original v2.4.16 guide was retired in v2.4.17. Current provider tests send a tiny deterministic JSON request with thinking disabled, `stream: false`, and no Mixarr-configured output-token parameter. See [the v2.4.17 guide](AI_STRUCTURED_OUTPUT_V2417.md).

Provider-native context and output constraints still apply. Mixarr never returns, logs, audits, or displays raw reasoning content.
