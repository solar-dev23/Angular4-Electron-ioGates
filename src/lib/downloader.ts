import { demux } from 'muxer';
import * as MultiDownloader from 'mt-downloader';
import { Observable as O } from 'rx';
import * as R from 'ramda';
import * as Type from './types';
//import * as Progress from 'ascii-progress';
import * as CliProgress from 'cli-progress';
//import * as queue from 'queue';
import * as fs from 'fs';
import { Directory } from '../lib/directory';
import { DownloadActivity } from '../lib/downloadActivity';

/**
 * Helps download a file from IOGates
 */
export class Downloader {
  public static CALCULATE_TRANSFER_SPEED(sent: number[], timestamps: number[], buffer: number | null = null) {
    const sentLen = sent.length;
    const timeLen = timestamps.length;
    if (sentLen === 0 || timeLen === 0 || sentLen !== timeLen) {
      return 0;
    }
    const lastIdx = sentLen - 1;
    let bytes;
    let ms;
    if (buffer === null) {
      bytes = sent[lastIdx] - sent[0];
      ms = timestamps[lastIdx] - timestamps[0];
    } else {
      let bufferIdx = lastIdx - buffer;
      if (bufferIdx < 0) {
        bufferIdx = 0;
      }
      bytes = (sent[lastIdx] - sent[bufferIdx]);
      ms = (timestamps[lastIdx] - timestamps[bufferIdx]);
    }
    if (ms === 0) {
      return 0;
    }

    return (bytes / 1048576) / (ms / 1000);
  }

  public downloadFiles(files: Type.File[]): Promise<Type.UploadResponse[]> {
    const self = this;

    return new Promise(async (resolve, reject) => {
      const results = [];
      for (const file of files) {
        try {
          const r: Type.UploadResponse = await self.downloadFile(file);
          results.push(r);
          r.file.downloaded = true;
          r.file.save();
        } catch (err) {
          return reject(err);
        }
      }

      return resolve(results);
    });
  }

  public downloadFile(file: Type.File): Promise<Type.UploadResponse> {
    const downloadActivity = new DownloadActivity();
    return downloadActivity
      .attachFile(file)
      .onceReady()
      .then(() => {
        const mtdPath: string = MultiDownloader.MTDPath(file.destination);
        const options = {
          url: file.download,
          path: file.destination
        };
        const sentValues = [], sentTimestamps = [];
        const bar = new CliProgress.Bar({
          format: `${this.makeFileName(file)} [{bar}] {percentage}% | ETA: {eta}s | Speed: {speed}`,
          stopOnComplete: true,
          clearOnComplete: false,
          etaBuffer: 20,
          fps: 5,
          payload: { speed: 'N/A' }
        }, CliProgress.Presets.shades_classic);
        bar.start(1000, 0);

        let downloadFromMTDFile$;
        if (fs.existsSync(mtdPath)) {
          global['logger'].info('resume %s', file.destination);
          downloadFromMTDFile$ = MultiDownloader.DownloadFromMTDFile(mtdPath).share();
          downloadActivity.resume();
        } else {
          global['logger'].info('download %s', file.destination);
          const createMTDFile$ = this.createDownload(options);
          downloadFromMTDFile$ = createMTDFile$
            .last()
            .map(mtdPath)
            .flatMap(MultiDownloader.DownloadFromMTDFile).share();

          downloadActivity.start();
        }
        const [{ fdR$, meta$ }] = demux(downloadFromMTDFile$, 'fdR$', 'meta$');
        const finalizeDownload$ = downloadFromMTDFile$.last()
          .withLatestFrom(fdR$, meta$, (_: {}, fd: {}, meta: {}) => ({
            fd$: O.just(fd),
            meta$: O.just(meta)
          }))
          .flatMap(MultiDownloader.FinalizeDownload)
          .share()
          .last();

        const fd$ = finalizeDownload$
          .withLatestFrom(fdR$)
          .map(R.tail)
          .flatMap(R.map(R.of));
        const closeFile = MultiDownloader.FILE.close(fd$).last().toPromise();

        this.downloaded(meta$).subscribe((d: number) => {
          sentValues.push(d);
          sentTimestamps.push(+ new Date());
        });

        MultiDownloader
          .Completion(meta$)
          .subscribe((i: number) => {
            const p = Math.ceil(i * 1000);
            if (bar.value !== p) {
              bar.update(p, {
                speed: `${Downloader.CALCULATE_TRANSFER_SPEED(sentValues, sentTimestamps, i === 1 ? null : 10).toFixed(1)} MB/s`
              });
            }

            // acknowledge progress.
            downloadActivity.progress(0, 0);
          });

        return closeFile;
      })
      .then(() => {
        const uploadResponse: Type.UploadResponse = new Type.UploadResponse();
        downloadActivity.completed();
        uploadResponse.dest = file.destination;
        uploadResponse.success = true;
        uploadResponse.file = file;
        global['logger'].info('completed %s', file.destination);
        return uploadResponse;
      });
  }

  private makeFileName(file) {
    let fileName = file.name;
    if (fileName.length > 50) {
      fileName = `${fileName.substr(0, 47)}...`;
    } else {
      let len = fileName.length;
      while (len < 50) {
        fileName += ' ';
        len += 1;
      }
    }
    return fileName;
  }

  public downloaded: O = (m: O) => {
    return m.map((meta) => {
      return R.sum(meta.offsets) - R.sum(R.map(R.nth(0), meta.threads)) + R.length(meta.threads) - 1;
    });
  }

  public setupHierarchy(entries: Type.File[], destination: string) {
    const tree = new Map();
    const files = [];
    const dirs = [];
    for (const entry of entries.filter(Boolean)) {
      entry.destination = this.location(entry, destination, tree);
      tree.set(entry.file_id, entry);
      if (entry.isDirectory()) {
        const dir = new Directory(entry.destination);
        dirs.push(dir.create());
        continue;
      }
      files.push(entry);
    }

    return Promise
      .all(dirs)
      .then(() => {
        return files;
      });
  }

  private location(file: Type.File, destination: string, tree: Map<number, object>) {
    if (!file.parent) {
      return [destination, file.name].join('/');
    }
    const parent = <Type.File>tree.get(+file.parent);
    let path = this.location(parent, destination, tree);
    if (parent.type === 'dir') {
      path = [path, file.name].join('/');
    } else {
      path = path.split('/');
      path.pop();
      path.push(file.name);
      path = path.join('/');
    }

    return path;
  }

  private createDownload(options: object) {
    return MultiDownloader.CreateMTDFile(options).share();
  }

}
