const fs = require('fs');

// Extract strictly the first valid http/https URL match
const envUrl = process.env.JELLYFIN_URL || '';
const urlMatch = envUrl.match(/https?:\/\/[a-zA-Z0-9.-]+/);
const JELLYFIN_URL = urlMatch ? urlMatch[0] : 'https://spread.thepebbles.tech';

const USERNAME = (process.env.JELLYFIN_USER || 'union6').trim();
const PASSWORD = (process.env.JELLYFIN_PASS || '1499952177779513').trim();

// Channels with expanded genre filters
const CHANNELS = [
  { 
    id: 'cartoons', 
    name: '90s Cartoons', 
    genres: ['Animation', 'Anime', 'Cartoons', 'Children'] 
  },
  { 
    id: 'sitcoms', 
    name: 'Retro Sitcoms', 
    genres: ['Comedy', 'Sitcom', 'Retro', 'British Comedy'] 
  }
];

// Seeded PRNG (Mulberry32) for deterministic, reproducible shuffling
function seededRandom(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle using our seeded PRNG
function shuffleDeterministic(array, seedValue = 123456) {
  const rng = seededRandom(seedValue);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Helper function to fetch with retry logic for server HTTP 500/timeout issues
async function fetchWithRetry(url, options = {}, retries = 3, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      console.warn(`Fetch returned status ${res.status}. Attempt ${i + 1} of ${retries}...`);
    } catch (err) {
      console.warn(`Fetch error: ${err.message}. Attempt ${i + 1} of ${retries}...`);
    }
    if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch from ${url} after ${retries} attempts.`);
}

async function generateSchedule() {
  console.log(`Connecting to Jellyfin server: ${JELLYFIN_URL}`);

  // 1. Authenticate with Jellyfin
  const authRes = await fetchWithRetry(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="NostalgexBuilder", Device="Server", DeviceId="cron-1", Version="1.0.0"'
    },
    body: JSON.stringify({ Username: USERNAME, Pw: PASSWORD })
  });

  const authData = await authRes.json();
  const apiKey = authData.AccessToken;
  const userId = authData.User.Id;

  console.log('Authenticated successfully. Fetching library items...');

  // 2. Fetch items in smaller batches (limit = 50 to avoid HTTP 500 server timeouts)
  let allEpisodes = [];
  const limit = 50;
  let startIndex = 0;
  let hasMore = true;
  const maxItemsToFetch = 2000;

  while (hasMore && allEpisodes.length < maxItemsToFetch) {
    const itemsUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Episode&Recursive=true&Fields=Genres,RunTimeTicks&StartIndex=${startIndex}&Limit=${limit}&api_key=${apiKey}`;
    
    try {
      const itemsRes = await fetchWithRetry(itemsUrl);
      const itemsData = await itemsRes.json();
      const batch = itemsData.Items || [];
      
      allEpisodes = allEpisodes.concat(batch);
      console.log(`Fetched batch: ${batch.length} items (Total: ${allEpisodes.length})`);

      if (batch.length < limit || itemsData.TotalRecordCount <= allEpisodes.length) {
        hasMore = false;
      } else {
        startIndex += limit;
      }
    } catch (err) {
      console.error(`Skipping offset ${startIndex} due to persistent error:`, err.message);
      // Skip ahead to the next batch instead of crashing the whole build
      startIndex += limit;
    }
  }

  console.log(`Successfully compiled ${allEpisodes.length} total episodes.`);

  const outputSchedule = {
    apiKey: apiKey,
    generatedAt: Date.now(),
    channels: {}
  };

  // 3. Build channels using deterministic shuffling
  for (let cIdx = 0; cIdx < CHANNELS.length; cIdx++) {
    const ch = CHANNELS[cIdx];
    const matching = allEpisodes.filter(e => {
      if (!e.Genres || e.Genres.length === 0) return false;
      return e.Genres.some(g => ch.genres.map(cg => cg.toLowerCase()).includes(g.toLowerCase()));
    });

    const sourcePool = matching.length >= 5 ? matching : allEpisodes;
    
    // Sort alphabetically first so the input array order is 100% predictable across runs
    const sortedPool = [...sourcePool].sort((a, b) => a.Id.localeCompare(b.Id));
    
    // Deterministically shuffle using a unique channel seed
    const channelSeed = 987654 + cIdx * 4321;
    const shuffled = shuffleDeterministic(sortedPool, channelSeed);

    let totalDuration = 0;
    const playlist = shuffled.map(item => {
      const runtime = Math.floor((item.RunTimeTicks || 0) / 10000000);
      const entry = {
        id: item.Id,
        title: item.Name,
        series: item.SeriesName || '',
        start: totalDuration,
        duration: runtime > 0 ? runtime : 1800
      };
      totalDuration += entry.duration;
      return entry;
    });

    outputSchedule.channels[ch.id] = {
      name: ch.name,
      totalLoopSeconds: totalDuration || 3600,
      items: playlist
    };
  }

  // 4. Save schedule
  fs.writeFileSync('channels.json', JSON.stringify(outputSchedule, null, 2));
  console.log('channels.json generated successfully!');
}

generateSchedule().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
