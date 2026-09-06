const fs = require('fs');
const https = require('https');

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNELS_FILE = './YTchannels.json';

// Converts YouTube's ISO 8601 duration (e.g. "PT1M30S") into total seconds
function parseISODuration(isoDuration) {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || 0, 10);
  const minutes = parseInt(match[2] || 0, 10);
  const seconds = parseInt(match[3] || 0, 10);
  return hours * 3600 + minutes * 60 + seconds;
}

async function updateDurations() {
  if (!API_KEY) {
    console.error('YOUTUBE_API_KEY environment variable is missing.');
    process.exit(1);
  }

  const channels = JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8'));
  let videoMap = {};

  // Find all video items across every channel playlist
  channels.forEach(ch => {
    if (Array.isArray(ch.playlist)) {
      ch.playlist.forEach(vid => {
        if (vid.id) videoMap[vid.id] = vid;
      });
    }
  });

  const videoIds = Object.keys(videoMap);
  console.log(`Checking durations for ${videoIds.length} total videos...`);

  // Batch query YouTube API in chunks of 50
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50).join(',');
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${chunk}&key=${API_KEY}`;

    await new Promise((resolve) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.items) {
              response.items.forEach(item => {
                const seconds = parseISODuration(item.contentDetails.duration);
                if (videoMap[item.id]) {
                  videoMap[item.id].duration = seconds;
                }
              });
            }
          } catch (e) {
            console.error('Error parsing response:', e);
          }
          resolve();
        });
      });
    });
  }

  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
  console.log('Finished updating YTchannels.json with exact video durations!');
}

updateDurations();
