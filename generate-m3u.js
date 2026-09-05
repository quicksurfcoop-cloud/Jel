const fs = require('fs');

// Load generated schedule
const schedule = JSON.parse(fs.readFileSync('channels.json', 'utf8'));
const JELLYFIN_URL = 'https://spread.thepebbles.tech';
const apiKey = schedule.apiKey;

let masterM3u = '#EXTM3U\n\n';

for (const [channelId, channel] of Object.entries(schedule.channels)) {
  let channelM3u = '#EXTM3U\n\n';

  channel.items.forEach(item => {
    const title = item.series ? `${item.series} - ${item.title}` : item.title;
    
    // Transcoded stream URL optimized for VLC playback
    const streamUrl = `${JELLYFIN_URL}/Videos/${item.id}/master.m3u8?` +
      `api_key=${apiKey}` +
      `&MediaSourceId=${item.id}` +
      `&VideoCodec=h264` +
      `&AudioCodec=aac` +
      `&AudioChannels=2` +
      `&MaxAudioChannels=2` +
      `&SegmentContainer=ts` +
      `&VideoBitrate=8000000`;

    const entry = `#EXTINF:${item.duration}, [${channel.name}] ${title}\n${streamUrl}\n\n`;
    
    channelM3u += entry;
    masterM3u += entry;
  });

  // Save individual playlist for this channel (e.g., cartoons.m3u)
  fs.writeFileSync(`${channelId}.m3u`, channelM3u);
  console.log(`Generated ${channelId}.m3u`);
}

// Save one master playlist containing all channels
fs.writeFileSync('all-channels.m3u', masterM3u);
console.log('Generated all-channels.m3u cleanly!');
