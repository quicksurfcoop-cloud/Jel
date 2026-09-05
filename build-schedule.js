const fs = require('fs');

const envUrl = process.env.JELLYFIN_URL || '';
const urlMatch = envUrl.match(/https?:\/\/[a-zA-Z0-9.-]+/);
const JELLYFIN_URL = urlMatch ? urlMatch[0] : 'https://spread.thepebbles.tech';

const USERNAME = (process.env.JELLYFIN_USER || 'union6').trim();
const PASSWORD = (process.env.JELLYFIN_PASS || '1499952177779513').trim();

// Refined Channel Specifications
const CHANNELS = [
  { 
    id: 'cartoons', 
    name: '90s Cartoons', 
    genres: ['Animation', 'Anime', 'Cartoons', 'Children'],
    tags: ['Animation', 'Cartoons', '90s'], // Check tags as well
    excludeGenres: ['Documentary', 'Reality', 'Action'],
    allowedRatings: ['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'G', 'PG'],
    excludeTitles: ['South Park', 'Beavis and Butt-Head', 'Family Guy', 'Spawn', 'Futurama', 'King of the Hill', 'American Dad'],
    startYear: 1988,
    endYear: 2001
  },
  { 
    id: 'sitcoms', 
    name: 'Retro Sitcoms', 
    genres: ['Sitcom', 'British Comedy'],
    tags: ['Sitcom', 'Sitcoms', 'British Sitcom'], // Added Sitcom tags
    excludeGenres: ['Reality', 'Game Show', 'Documentary', 'Talk Show'],
    startYear: 1900,
    endYear: 2012
  }
];

function seededRandom(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministic(array, seedValue = 123456) {
  const rng = seededRandom(seedValue);
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function generateSchedule() {
  console.log(`Connecting to Jellyfin server: ${JELLYFIN_URL}`);

  // 1. Authenticate
  const authRes = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emby-Authorization': 'MediaBrowser Client="NostalgexBuilder", Device="Server", DeviceId="cron-1", Version="1.0.0"'
    },
    body: JSON.stringify({ Username: USERNAME, Pw: PASSWORD })
  });

  if (!authRes.ok) {
    throw new Error(`Authentication failed with status ${authRes.status}`);
  }

  const authData = await authRes.json();
  const apiKey = authData.AccessToken;
  const userId = authData.User.Id;

  console.log('Authenticated successfully. Fetching TV Series metadata...');

  // 2. Fetch all Series with extended metadata fields (Genres, OfficialRating, ProductionYear)
  const seriesUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Series&Recursive=true&Fields=Genres,OfficialRating,ProductionYear&api_key=${apiKey}`;
  const seriesRes = await fetch(seriesUrl);
  if (!seriesRes.ok) throw new Error(`Failed to fetch series list: ${seriesRes.status}`);
  
  const seriesData = await seriesRes.json();
  const allSeries = seriesData.Items || [];
  console.log(`Found ${allSeries.length} total TV Series in library.`);

  const outputSchedule = {
    apiKey: apiKey,
    generatedAt: Date.now(),
    channels: {}
  };

  // 3. Process each channel show-by-show
  for (let cIdx = 0; cIdx < CHANNELS.length; cIdx++) {
    const ch = CHANNELS[cIdx];
    
    // Filter matching series based on channel criteria
    const matchingSeries = allSeries.filter(s => {
      if (!s.Genres || s.Genres.length === 0) return false;

      // Match target genres
      const hasGenre = s.Genres.some(g => 
        ch.genres.map(cg => cg.toLowerCase()).includes(g.toLowerCase())
      );
      if (!hasGenre) return false;

      // Check excluded genres
      if (ch.excludeGenres) {
        const hasExcluded = s.Genres.some(g => 
          ch.excludeGenres.map(eg => eg.toLowerCase()).includes(g.toLowerCase())
        );
        if (hasExcluded) return false;
      }

      // Filter by Official Ratings (e.g. exclude TV-MA, TV-14)
      if (ch.allowedRatings && ch.allowedRatings.length > 0) {
        const rating = (s.OfficialRating || '').trim().toUpperCase();
        // If a rating exists and isn't allowed, exclude it
        if (rating && !ch.allowedRatings.map(r => r.toUpperCase()).includes(rating)) {
          return false;
        }
      }

      // Check explicit title exclusions
      if (ch.excludeTitles && ch.excludeTitles.length > 0) {
        const isExcluded = ch.excludeTitles.some(title => 
          s.Name.toLowerCase().includes(title.toLowerCase())
        );
        if (isExcluded) return false;
      }

      // Filter by Production Year range
      const prodYear = s.ProductionYear || 0;
      if (ch.startYear && prodYear && prodYear < ch.startYear) return false;
      if (ch.endYear && prodYear && prodYear > ch.endYear) return false;

      return true;
    });

    console.log(`Channel [${ch.name}]: Matched ${matchingSeries.length} series. Fetching episodes per show...`);

    let channelEpisodes = [];

    // Fetch episodes show-by-show using individual ParentId lookups
    for (const show of matchingSeries) {
      let startIndex = 0;
      let hasMore = true;
      const limit = 100;

      while (hasMore) {
        const epUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Episode&Recursive=true&ParentId=${show.Id}&Fields=RunTimeTicks&StartIndex=${startIndex}&Limit=${limit}&api_key=${apiKey}`;
        
        try {
          const epRes = await fetch(epUrl);
          if (!epRes.ok) {
            console.error(`Failed to fetch episodes for show "${show.Name}" at offset ${startIndex}`);
            break;
          }

          const epData = await epRes.json();
          const batch = epData.Items || [];
          channelEpisodes = channelEpisodes.concat(batch);

          if (batch.length < limit || epData.TotalRecordCount <= (startIndex + batch.length)) {
            hasMore = false;
          } else {
            startIndex += limit;
          }
        } catch (err) {
          console.error(`Error querying show "${show.Name}":`, err.message);
          break;
        }
      }
    }

    console.log(`Channel [${ch.name}]: Successfully fetched ${channelEpisodes.length} total episodes.`);

    // Sort deterministically by ID and shuffle using a unique channel seed
    const sortedPool = [...channelEpisodes].sort((a, b) => a.Id.localeCompare(b.Id));
    const channelSeed = 987654 + cIdx * 4321;
    const shuffled = shuffleDeterministic(sortedPool, channelSeed);

    let totalDuration = 0;
    const playlist = shuffled.map(item => {
      const runtime = item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000000) : 1320;
      const entry = {
        id: item.Id,
        title: item.Name,
        series: item.SeriesName || '',
        start: totalDuration,
        duration: runtime > 0 ? runtime : 1320
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
  console.log('channels.json generated cleanly!');
}

generateSchedule().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
