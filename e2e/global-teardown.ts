// Deliberately leaves helpdesk_test as the run left it: global-setup resets it before the
// next run anyway, and the leftover state is what you inspect after a failure.
export default function globalTeardown() {
  console.log('E2E run complete. helpdesk_test left intact for debugging (reset on the next run).')
}
