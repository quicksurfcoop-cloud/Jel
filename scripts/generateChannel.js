const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

// Converts ISO 8601 duration (e.g. PT4M13S) to total seconds
function parseISODuration(durationStr) {
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  const seconds = parseInt(match[3] || 0, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

async function generateChannel(keyword, channelId, channelName, maxResults = 15) {
  // 1. Search for embeddable videos matching the keyword
  const searchRes = await youtube.search.list({
    part: ['snippet'],
    q: keyword,
    type: ['video'],
    videoEmbeddable: 'true',
    maxResults: maxResults,
  });

  const videoIds = searchRes.data.items.map((item) => item.id.videoId);
  if (!videoIds.length) {
    console.log(`No videos found for keyword: ${keyword}`);
    return;
  }

  // 2. Fetch exact video durations and titles
  const videoRes = await youtube.videos.list({
    part: ['snippet', 'contentDetails'],
    id: videoIds.join(','),
  });

  const playlist = [];
  for (const item of videoRes.data.items) {
    const durationSeconds = parseISODuration(item.contentDetails.duration);

    // Filter out shorts (<30s) or ultra-long videos (>30m)
    if (durationSeconds >= 30 && durationSeconds <= 1800) {
      playlist.push({
        id: item.id,
        title: item.snippet.title,
        duration: durationSeconds,
      });
    }
  }

  // 3. Load existing YTchannels.json file or create a new array
  const jsonPath = path.join(__dirname, '..', 'YTchannels.json');
  let channels = [];
  if (fs.existsSync(jsonPath)) {
    channels = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }

  const newChannel = {
    id: Number(channelId),
    name: channelName,
    broadcastStart: '00:00',
    playlist: playlist,
  };

  // Replace existing channel with same ID, or append new channel
  const existingIdx = channels.findIndex((c) => c.id === newChannel.id);
  if (existingIdx !== -1) {
    channels[existingIdx] = newChannel;
  } else {
    channels.push(newChannel);
  }

  // Write updated data back to YTchannels.json
  fs.writeFileSync(jsonPath, JSON.stringify(channels, null, 2));
  console.log(`Successfully updated Channel ${channelId}: "${channelName}" with ${playlist.length} tracks.`);
}

// Read arguments passed from GitHub Action CLI
const [keyword, channelId, channelName, maxResults] = process.argv.slice(2);
generateChannel(keyword, channelId, channelName, maxResults ? parseInt(maxResults, 10) : 15);
