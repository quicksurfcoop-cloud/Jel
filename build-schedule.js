const fs = require('fs');

// Extract strictly the first valid http/https URL match
const envUrl = process.env.JELLYFIN_URL || '';
const urlMatch = envUrl.match(/https?:\/\/[a-zA-Z0-9.-]+/);
const JELLYFIN_URL = urlMatch ? urlMatch[0] : 'https://spread.thepebbles.tech';

const USERNAME = (process.env.JELLYFIN_USER || 'union6').trim();
const PASSWORD = (process.env.JELLYFIN_PASS || '1499952177779513').trim();

const CHANNELS = [
  { id: 'cartoons', name: '90s Cartoons', genre: 'Animation' },
  { id: 'sitcoms', name: 'Retro Sitcoms', genre: 'Comedy' }
];

async function generateSchedule() {
  console.log(`Connecting to Jellyfin server: ${JELLYFIN_URL}`);

  // 1. Authenticate with Jellyfin
  const authRes = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="NostalgexBuilder", Device="Server", DeviceId="cron-1", Version="1.0.0"'
    },
    body: JSON.stringify({ Username: USERNAME, Pw: PASSWORD })
  });

  if (!authRes.ok) {
    throw new Error(`Authentication failed with HTTP status ${authRes.status}`);
  }

  const authData = await authRes.json();
  const apiKey = authData.AccessToken;
  const userId = authData.User.Id;

  console.log('Authenticated successfully. Fetching library items in batches...');

  // 2. Paginated Fetching to Prevent 504 Timeouts
  let allEpisodes = [];
  const limit = 100;
  let startIndex = 0;
  let hasMore = true;
  const maxItemsToFetch = 500; // Limits total fetch depth to protect connection

  while (hasMore && allEpisodes.length < maxItemsToFetch) {
    const itemsUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Episode&Recursive=true&Fields=Genres,RunTimeTicks&StartIndex=${startIndex}&Limit=${limit}&api_key=${apiKey}`;
    
    const itemsRes = await fetch(itemsUrl);
    if (!itemsRes.ok) {
      throw new Error(`Failed to fetch items at offset ${startIndex} with HTTP status ${itemsRes.status}`);
    }

    const itemsData = await itemsRes.json();
    const batch = itemsData.Items || [];
    
    allEpisodes = allEpisodes.concat(batch);
    console.log(`Fetched batch: ${batch.length} items (Total: ${allEpisodes.length})`);

    if (batch.length < limit || itemsData.TotalRecordCount <= allEpisodes.length) {
      hasMore = false;
    } else {
      startIndex += limit;
    }
  }

  console.log(`Successfully compiled ${allEpisodes.length} total episodes.`);

  const outputSchedule = {
    generatedAt: Date.now(),
    channels: {}
  };

  // 3. Build channels and calculate timelines
  for (const ch of CHANNELS) {
    const matching = allEpisodes.filter(e => e.Genres && e.Genres.includes(ch.genre));
    const playlistSource = matching.length > 0 ? matching : allEpisodes;
    const shuffled = [...playlistSource].sort(() => 0.5 - Math.random());

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

  // 4. Write output file
  fs.writeFileSync('channels.json', JSON.stringify(outputSchedule, null, 2));
  console.log('channels.json generated and saved successfully!');
}

generateSchedule().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
