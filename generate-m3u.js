const fs = require('fs');

if (!fs.existsSync('channels.json')) {
  console.error('Error: channels.json not found! Run build-schedule.js first.');
  process.exit(1);
}

const schedule = JSON.parse(fs.readFileSync('channels.json', 'utf8'));
const JELLYFIN_URL = process.env.JELLYFIN_URL || 'https://spread.thepebbles.tech';
const apiKey = schedule.apiKey || '';

const nowSeconds = Math.floor(Date.now() / 1000);
const FIXED_EPOCH_SECONDS = 1767225600; 

let masterM3u = '#EXTM3U\n\n';

for (const [channelId, channel] of Object.entries(schedule.channels)) {
  const elapsedSeconds = (nowSeconds - FIXED_EPOCH_SECONDS) % channel.totalLoopSeconds;

  let activeItem = channel.items[0];
  let seekOffset = 0;

  for (const item of channel.items) {
    const itemEnd = item.start + item.duration;
    if (elapsedSeconds >= item.start && elapsedSeconds < itemEnd) {
      activeItem = item;
      seekOffset = elapsedSeconds - item.start;
      break;
    }
  }

  const title = activeItem.series ? `${activeItem.series} - ${activeItem.title}` : activeItem.title;

  // Direct video stream URL (VLC natively handles all codecs, containers, and seeking)
  const streamUrl = `${JELLYFIN_URL}/Items/${activeItem.id}/Download?api_key=${apiKey}`;

  const channelM3u = `#EXTM3U\n#EXTINF:${activeItem.duration}, [${channel.name}] ${title}\n${streamUrl}\n`;
  fs.writeFileSync(`${channelId}.m3u`, channelM3u);
  console.log(`Generated ${channelId}.m3u`);

  masterM3u += `#EXTINF:${activeItem.duration}, [${channel.name}] ${title}\n${streamUrl}\n\n`;
}

fs.writeFileSync('all-channels.m3u', masterM3u);
console.log('Generated all-channels.m3u cleanly!');
