const fs = require('fs');

const JELLYFIN_URL = process.env.JELLYFIN_URL || 'https://spread.thepebbles.tech';
const USERNAME = process.env.JELLYFIN_USER || 'union6';
const PASSWORD = process.env.JELLYFIN_PASS || '1499952177779513';

async function generateSchedule() {
  console.log('Connecting to:', JELLYFIN_URL);
  
  if (!JELLYFIN_URL || !USERNAME || !PASSWORD) {
    throw new Error('Missing environment variables for Jellyfin authentication.');
  }

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

  console.log('Authenticated successfully. Fetching items...');

  const itemsRes = await fetch(`${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Episode&Recursive=true&Fields=Genres,RunTimeTicks&api_key=${apiKey}`);
  const itemsData = await itemsRes.json();
  const allEpisodes = itemsData.Items || [];

  console.log(`Retrieved ${allEpisodes.length} total episodes.`);

  const outputSchedule = {
    generatedAt: Date.now(),
    channels: {
      cartoons: {
        name: "90s Cartoons",
        totalLoopSeconds: 3600,
        items: allEpisodes.slice(0, 50).map(e => ({
          id: e.Id,
          title: e.Name,
          series: e.SeriesName || '',
          start: 0,
          duration: 1800
        }))
      }
    }
  };

  fs.writeFileSync('channels.json', JSON.stringify(outputSchedule, null, 2));
  console.log('channels.json written successfully!');
}

generateSchedule().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1); // Force workflow to report failure if the script crashes
});



// Define your channel filters
const CHANNELS = [
  { id: 'cartoons', name: '90s Cartoons', genre: 'Animation' },
  { id: 'sitcoms', name: 'Retro Sitcoms', genre: 'Comedy' }
];

async function generateSchedule() {
  console.log('Authenticating with Jellyfin...');
  
  // 1. Authenticate
  const authRes = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
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

  // 2. Fetch all episodes in bulk
  console.log('Fetching episodes...');
  const itemsRes = await fetch(`${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Episode&Recursive=true&Fields=Genres,RunTimeTicks&api_key=${apiKey}`);
  const itemsData = await itemsRes.json();
  const allEpisodes = itemsData.Items || [];

  const outputSchedule = {
    generatedAt: Date.now(),
    channels: {}
  };

  // 3. Group into channels and calculate timeline positions
  for (const ch of CHANNELS) {
    const matching = allEpisodes.filter(e => e.Genres && e.Genres.includes(ch.genre));
    
    // Shuffle list for continuous variety
    const shuffled = matching.sort(() => 0.5 - Math.random());

    let totalDuration = 0;
    const playlist = shuffled.map(item => {
      const runtime = Math.floor((item.RunTimeTicks || 0) / 10000000); // Ticks to seconds
      const entry = {
        id: item.Id,
        title: item.Name,
        series: item.SeriesName || '',
        start: totalDuration,
        duration: runtime
      };
      totalDuration += runtime;
      return entry;
    }).filter(e => e.duration > 0);

    outputSchedule.channels[ch.id] = {
      name: ch.name,
      totalLoopSeconds: totalDuration,
      items: playlist
    };
  }

  // 4. Save to json
  fs.writeFileSync('channels.json', JSON.stringify(outputSchedule, null, 2));
  console.log('Schedule successfully saved to channels.json!');
}

generateSchedule().catch(console.error);
