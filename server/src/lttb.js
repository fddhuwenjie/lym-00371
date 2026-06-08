function lttb(data, threshold) {
  if (!data || data.length <= threshold) {
    return data || [];
  }

  const sampled = [];
  const dataLength = data.length;

  let sampledIndex = 0;
  sampled[sampledIndex++] = data[0];

  const bucketSize = (dataLength - 2) / (threshold - 2);

  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1;
    const avgRangeEndClamped = avgRangeEnd < dataLength ? avgRangeEnd : dataLength;

    const avgRangeLength = avgRangeEndClamped - avgRangeStart;

    let avgX = 0;
    let avgY = 0;

    for (let j = avgRangeStart; j < avgRangeEndClamped; j++) {
      avgX += data[j].timestamp;
      avgY += data[j].value;
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeOffs = Math.floor(i * bucketSize) + 1;
    const rangeTo = Math.floor((i + 1) * bucketSize) + 1;

    const pointAx = data[a].timestamp;
    const pointAy = data[a].value;

    let maxArea = -1;
    let maxAreaIndex = rangeOffs;

    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs(
        (pointAx - avgX) * (data[j].value - pointAy) -
        (pointAx - data[j].timestamp) * (avgY - pointAy)
      ) * 0.5;

      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = j;
      }
    }

    sampled[sampledIndex++] = data[maxAreaIndex];
    a = maxAreaIndex;
  }

  sampled[sampledIndex] = data[dataLength - 1];

  return sampled;
}

function autoDownsample(data, maxPoints = 1000) {
  if (data.length <= maxPoints) {
    return data;
  }
  return lttb(data, maxPoints);
}

module.exports = {
  lttb,
  autoDownsample
};
