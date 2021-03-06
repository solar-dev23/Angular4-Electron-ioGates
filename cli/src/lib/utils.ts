import { File } from 'iotransfer-core';
import * as CliProgress from 'cli-progress';

export const makeFileName = (file: File) => {
  const columns = process.stdout.columns;
  const maxFileNameLength = columns - 100;
  let fileName = file.name;
  if (fileName.length > maxFileNameLength) {
    fileName = `${fileName.substr(0, maxFileNameLength - 3)}...`;
  } else {
    let len = fileName.length;
    while (len < maxFileNameLength) {
      fileName += ' ';
      len += 1;
    }
  }

  return fileName;
};

export const setupProgressBar = (file: File) => {
  return new CliProgress.Bar({
    format: `${makeFileName(file)} [{bar}] {percentage}% | ETA: {eta}s | Speed: {speed}`,
    stopOnComplete: true,
    clearOnComplete: false,
    etaBuffer: 20,
    fps: 5,
    payload: {speed: 'N/A'}
  }, CliProgress.Presets.shades_classic);
};