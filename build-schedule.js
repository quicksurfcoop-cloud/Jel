const fs = require('fs');

const envUrl = process.env.JELLYFIN_URL || '';
const urlMatch = envUrl.match(/https?:\/\/[a-zA-Z0-9.-]+/);
const JELLYFIN_URL = urlMatch ? urlMatch[0] : 'https://spread.thepebbles.tech';

const USERNAME = (process.env.JELLYFIN_USER || 'union6').trim();
const PASSWORD = (process.env.JELLYFIN_PASS || '1499952177779513').trim();

// Channel Specifications
const CHANNELS = [
  { 
    id: 'cartoons', 
    name: '90s Cartoons', 
    genres: ['Animation', 'Anime', 'Cartoons', 'Children'],
    tags: ['Animation', 'Cartoons', '90s'],
    excludeGenres: ['Documentary', 'Reality', 'Action'],
    allowedRatings: ['TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'G', 'PG'],
    excludeTitles: ['South Park', 'Beavis and Butt-Head', 'Family Guy', 'Spawn', 'Futurama', 'King of the Hill', 'American Dad'],
    startYear: 1988,
    endYear: 2004
  },
  { 
    id: 'sitcoms', 
    name: 'Retro Sitcoms', 
    genres: ['Sitcom', 'British Comedy'],
    tags: ['Sitcom', 'Sitcoms', 'British Sitcom'],
    excludeGenres: ['Reality', 'Game Show', 'Documentary', 'Talk Show'],
    startYear: 1960,
    endYear: 2012
  },
  {
    id: 'scream-kids',
    name: 'SCREAM KIDS',
    tags: ['spooky', 'spooky comedy', 'teen horror', 'ghosts', 'ghost', 'haunted house', 'witchcraft', 'witch', 'teen witch', 'school of witchcraft', 'monster', 'monsters', 'mummy', 'vampire', 'werewolf', 'halloween', 'magic', 'magical creature', 'supernatural', 'scare', 'modern fairy tale'],
    genres: [],
    excludeGenres: ['Documentary'],
    allowedRatings: ['TV-Y7', 'TV-G', 'TV-PG', 'G', 'PG'],
    excludeTitles: ['Sailor Moon', 'Dragon Ball', 'Aria', 'Avatar: The Last Airbender', 'Adventure Time', 'ThunderCats','Teenage Mutant Ninja Turtles', 'Penn & Teller: Fool Us', 'Dragon Ball GT'],
    startYear: 1970,
    endYear: 2026
  },
  {
    id: 'superhero-tv',
    name: 'Superhero TV',
    type: 'Series', // Tells Jellyfin to pull TV Shows
    tags: ['superhero', 'superhero team', 'female superhero', 'masked superhero', 'based on comic'],
    // If your script uses a single string for the API URL:
    // tagsApiString: 'superhero,superhero team,female superhero,masked superhero,based on comic'
  },
  {
    id: 'superhero-movies',
    name: 'Superhero Cinema',
    type: 'Movie', // Tells Jellyfin to pull Movies only
    tags: ['superhero', 'superhero team', 'superhero teamup', 'female superhero', 'masked superhero', 'based on comic']
  },
  {
    id: 'Period-dramas',
    name: 'Period Dramas & History',
    tags: ['historical', 'historical drama', 'historical fiction', 'costume drama', 'period drama', '19th century', '18th century', '17th century', '16th century', '15th century', 'victorian era', 'georgian or regency era', 'edwardian era', 'british history'],
    excludeGenres: ['Documentary', 'Animation', 'Comedy'],
    allowedRatings: ['TV-PG', 'TV-14', 'PG-13', 'PG'],
    startYear: 1970,
    endYear: 2015
  },
  {
    id: 'box-office',
    name: 'Sky Box Office - Latest Movies',
    // Expanded tags and genres to guarantee matches across modern films
    genres: ['Action', 'Adventure', 'Sci-Fi', 'Thriller', 'Drama', 'Comedy'],
    tags: ['blockbuster', 'box office', 'cinema', 'critically acclaimed', 'award winning', 'action', 'thriller', 'sci-fi', 'adventure'],
    excludeGenres: ['Documentary', 'Animation'],
    includeItemTypes: ['Movie'],
    allowedRatings: ['PG', 'PG-13', 'TV-14', 'R'],
    // Widened slightly to 2025-2026 so you get a full rotation of modern movies
    startYear: 2025,
    endYear: 2026
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

  console.log('Authenticated successfully. Fetching TV Series and Movie metadata...');

  // 2. Fetch both Series AND Movies metadata from Jellyfin
  const mediaUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Series,Movie&Recursive=true&Fields=Genres,Tags,OfficialRating,ProductionYear,RunTimeTicks&api_key=${apiKey}`;
  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) throw new Error(`Failed to fetch media list: ${mediaRes.status}`);
  
  const mediaData = await mediaRes.json();
  const allMedia = mediaData.Items || [];
  
  const allSeries = allMedia.filter(i => i.Type === 'Series');
  const allMovies = allMedia.filter(i => i.Type === 'Movie');

  console.log(`Found ${allSeries.length} TV Series and ${allMovies.length} Movies in library.`);

  const outputSchedule = {
    apiKey: apiKey,
    generatedAt: Date.now(),
    channels: {}
  };

  // Helper filter function for metadata matching
  const matchesCriteria = (item, ch) => {
    const itemGenres = (item.Genres || []).map(g => g.toLowerCase());
    const itemTags = (item.Tags || []).map(t => t.toLowerCase());

    const targetGenres = (ch.genres || []).map(cg => cg.toLowerCase());
    const targetTags = (ch.tags || []).map(ct => ct.toLowerCase());

    // Check if channel has any genre or tag rules specified
    const hasGenreRules = targetGenres.length > 0;
    const hasTagRules = targetTags.length > 0;

    if (hasGenreRules || hasTagRules) {
      const matchesGenre = hasGenreRules && itemGenres.some(g => targetGenres.includes(g));
      const matchesTag = hasTagRules && itemTags.some(t => targetTags.includes(t));

      if (!matchesGenre && !matchesTag) return false;
    }

    if (ch.excludeGenres) {
      const hasExcluded = itemGenres.some(g => 
        ch.excludeGenres.map(eg => eg.toLowerCase()).includes(g)
      );
      if (hasExcluded) return false;
    }

    if (ch.allowedRatings && ch.allowedRatings.length > 0) {
      const rating = (item.OfficialRating || '').trim().toUpperCase();
      if (rating && !ch.allowedRatings.map(r => r.toUpperCase()).includes(rating)) {
        return false;
      }
    }

    if (ch.excludeTitles && ch.excludeTitles.length > 0) {
      const isExcluded = ch.excludeTitles.some(title => 
        item.Name.toLowerCase().includes(title.toLowerCase())
      );
      if (isExcluded) return false;
    }

    const prodYear = item.ProductionYear || 0;
    if (ch.startYear && prodYear && prodYear < ch.startYear) return false;
    if (ch.endYear && prodYear && prodYear > ch.endYear) return false;

    return true;
  };

  // 3. Process each channel
  for (let cIdx = 0; cIdx < CHANNELS.length; cIdx++) {
    const ch = CHANNELS[cIdx];
    let channelItems = [];

    const includeTypes = ch.includeItemTypes || ['Series'];

    // A. Process Movies if configured
    if (includeTypes.includes('Movie')) {
      const matchingMovies = allMovies.filter(m => matchesCriteria(m, ch));
      console.log(`Channel [${ch.name}]: Matched ${matchingMovies.length} movies.`);
      channelItems = channelItems.concat(matchingMovies);
    }

    // B. Process TV Series Episodes if configured
    if (includeTypes.includes('Series')) {
      const matchingSeries = allSeries.filter(s => matchesCriteria(s, ch));
      console.log(`Channel [${ch.name}]: Matched ${matchingSeries.length} series. Fetching episodes...`);

      for (const show of matchingSeries) {
        let startIndex = 0;
        let hasMore = true;
        const limit = 100;

        while (hasMore) {
          const epUrl = `${JELLYFIN_URL}/Users/${userId}/Items?IncludeItemTypes=Episode&Recursive=true&ParentId=${show.Id}&Fields=RunTimeTicks&StartIndex=${startIndex}&Limit=${limit}&api_key=${apiKey}`;
          
          try {
            const epRes = await fetch(epUrl);
            if (!epRes.ok) break;

            const epData = await epRes.json();
            const batch = epData.Items || [];
            
            batch.forEach(ep => { ep.SeriesName = show.Name; });
            channelItems = channelItems.concat(batch);

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
    }

    console.log(`Channel [${ch.name}]: Total playable items pooled = ${channelItems.length}.`);

    // Sort deterministically by ID and shuffle
    const sortedPool = [...channelItems].sort((a, b) => a.Id.localeCompare(b.Id));
    const channelSeed = 987654 + cIdx * 4321;
    const shuffled = shuffleDeterministic(sortedPool, channelSeed);

    let totalDuration = 0;
    const playlist = shuffled.map(item => {
      const runtime = item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000000) : 5400;
      const entry = {
        id: item.Id,
        title: item.Name,
        series: item.SeriesName || '',
        start: totalDuration,
        duration: runtime > 0 ? runtime : 5400
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

// EXECUTE GENERATOR
generateSchedule().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
