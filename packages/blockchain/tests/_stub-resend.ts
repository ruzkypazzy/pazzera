class Resend {
  constructor(_key: string) {}
  emails = { send: async () => ({ data: { id: 'stub' }, error: null }) };
}
export default Resend;
export { Resend };
