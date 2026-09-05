const fs = require('fs');

const envUrl = process.env.JELLYFIN_URL || '';
const urlMatch = envUrl.match(/https?:\/\/[a-zA-Z0-9.-]+/);
const JELLYFIN_URL = urlMatch ? urlMatch[0] : 'https://spread.thepebbles.tech';

const USERNAME = (process.env.JELLYFIN_USER || 'union6').trim();
const PASSWORD = (process.env.JELLYFIN_PASS || '1499952177779513').trim();

// Refined Channel Specifications matching Genres, Tags, Ratings, and Years
const CHANNELS = [
  { 
    id: 'cartoons', 
    name: '90s Cartoons', 
    genres: ['Animation', 'Anime', 'Cartoons', 'Children'],
    tags: ['Animation', 'Cartoons', '90s'],
    excludeGenres: ['Documentary', 'Reality', 'Action'],
    // Whitelist daytime/family content ratings (filters out TV-MA, TV-14, R)
    allowedRatings: ['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'G', 'PG'],
    // Safety net for specific adult animation titles or unrated edge-cases
    excludeTitles: ['South Park', 'Beavis and Butt-Head', 'Family Guy', 'Spawn', 'Futurama', 'King of the Hill', 'American Dad'],
    startYear: 1988,
    endYear: 2004
  },
  { 
    id: 'sitcoms', 
    name: 'Retro Sitcoms', 
    genres: ['Sitcom', 'British Comedy'],
    tags: ['Sitcom', 'Sitcoms', 'British Sitcom'], // Catches shows tagged with Sitcom in Jellyfin
    excludeGenres: ['Reality', 'Game Show', 'Documentary', 'Talk Show'],
    startYear: 1960,
    endYear: 2012
  }
  {
  id: 'Period-dramas',
  name: 'Period Dramas & History',
  // Tags directly matching historical periods and costume drama aesthetics
  tags: [
    'historical',
    'historical drama',
    'historical fiction',
    'costume drama',
    'period drama',
    '19th century',
    '18th century',
    '17th century',
    '16th century',
    '15th century',
    'victorian era',
    'georgian or regency era',
    'edwardian era',
    'british history'
  ],
  genres: ['Drama', 'History'],
  excludeGenres: ['Documentary', 'Animation', 'Comedy'],
  allowedRatings: ['TV-PG', 'TV-14', 'PG-13', 'PG'],
  startYear: 1970,
  endYear: 2015
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

  // 2. Fetch all Series requesting Genres, Tags, OfficialRating, and ProductionYear
  const seriesUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Series&Recursive=true&Fields=Genres,Tags,OfficialRating,ProductionYear&api_key=${apiKey}`;
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
      const showGenres = (s.Genres || []).map(g => g.toLowerCase());
      const showTags = (s.Tags || []).map(t => t.toLowerCase());

      if (showGenres.length === 0 && showTags.length === 0) return false;

      // 1. Match target Genres OR target Tags
      const targetGenres = (ch.genres || []).map(cg => cg.toLowerCase());
      const targetTags = (ch.tags || []).map(ct => ct.toLowerCase());

      const matchesGenre = showGenres.some(g => targetGenres.includes(g));
      const matchesTag = showTags.some(t => targetTags.includes(t));

      if (!matchesGenre && !matchesTag) return false;

      // 2. Check excluded genres
      if (ch.excludeGenres) {
        const hasExcluded = showGenres.some(g => 
          ch.excludeGenres.map(eg => eg.toLowerCase()).includes(g)
        );
        if (hasExcluded) return false;
      }

      // 3. Official Content Rating check
      if (ch.allowedRatings && ch.allowedRatings.length > 0) {
        const rating = (s.OfficialRating || '').trim().toUpperCase();
        if (rating && !ch.allowedRatings.map(r => r.toUpperCase()).includes(rating)) {
          return false;
        }
      }

      // 4. Check explicit title exclusions
      if (ch.excludeTitles && ch.excludeTitles.length > 0) {
        const isExcluded = ch.excludeTitles.some(title => 
          s.Name.toLowerCase().includes(title.toLowerCase())
        );
        if (isExcluded) return false;
      }

      // 5. Production Year check
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
