// The probe's tool outputs, so tool('probe_echo') resolves { msg: string }.
declare module '@agentage/widget' {
  interface ToolOutputs {
    probe_echo: { msg: string };
  }
}

export {};
