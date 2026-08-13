// Offline upload queue: cases printed while the cloud was unreachable.
// Persisted in localStorage; flushed in the background. If an upload is lost
// for good, Scan-in still self-heals the case from the barcode.
const KEY = 'cf_station_queue';

// "cloud down" = network failure or server error; a 4xx is a real rejection
export const cloudDown = (err) => err.name === 'TypeError' || err.status >= 500;

export const loadQueue = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const save = (q) => localStorage.setItem(KEY, JSON.stringify(q));

export function enqueue(payload) {
  save([...loadQueue(), payload]);
}

// Returns the number still queued. Drops items the server accepted, and items
// it rejected outright (4xx — scan-in will recreate those from the label);
// keeps everything on network failure.
export async function flushQueue(api) {
  let q = loadQueue();
  const keep = [];
  for (const item of q) {
    try {
      await api.post('/api/cases', item);
    } catch (err) {
      if (cloudDown(err)) keep.push(item); // retry later
      // 4xx: drop; the barcode itself can recreate the case at scan-in
    }
  }
  save(keep);
  return keep.length;
}
