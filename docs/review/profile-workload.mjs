// Synthetic CPU-only fixture: no app data, network, credentials, or local file reads.
// Run with Node's --cpu-prof options from the review setup guide.
function reviewWorkload() {
  let checksum = 0;
  for (let index = 0; index < 5_000_000; index++) checksum += Math.sqrt(index % 97);
  return checksum;
}
const until = performance.now() + 1500;
let checksum = 0;
while (performance.now() < until) checksum += reviewWorkload();
console.log(`Synthetic workload complete: ${Math.round(checksum)}`);
