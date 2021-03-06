import * as Bluebird from 'bluebird';
import debug from 'debug';
import * as http from 'http';
import * as _ from 'lodash';
import * as request from 'request';
import {IAuth} from '../interfaces/iauth';
import {IFile} from '../interfaces/ifile';
import {IFiles} from '../interfaces/ifiles';
import {IShare} from '../interfaces/ishare';
const log = debug('io:lib:iogates');

/**
 * API wrapper class for IOGates
 */
export class IOGates {
  private token: string;
  private baseUrl: string;
  private appName: string;
  constructor() {
    this.baseUrl = 'https://share-web02-transferapp.iogates.com/api';
    this.token = '';
    this.appName =  'iotransfer';
  }

  public static GET_BASE_URL(url: string): string {
    const re = /^(https?:\/\/[a-zA-Z\-._0-9]+)(\/.*)$/i;
    const matches = re.exec(url);
    if (matches !== null) {
      return matches[1];
    } else {
      throw Error('Unknown Share URL scheme');
    }
  }

  public authenticateFromUrl(share: IShare): Promise<IAuth> {
    log('called authenticateFromUrl');

    return new Promise((resolve: Function, reject: Function) => {
      this.getRequest().post(
        {
          url: '/authtoken',
          json: {
            url: share.url,
            deviceId: global['device-id'],
            appName: this.appName,
          },
        },
        (err: Error, r: http.IncomingMessage, data: IAuth) => {
          if (r.statusCode !== 200) {
            return reject(err);
          }
          log('received token: ', data.token);
          this.token = data.token;
          share.token = data.token;

          return resolve(share);
        });
    });
  }

  public readFiles(): Bluebird<IFiles> {
    log('called readFiles');

    return new Bluebird((resolve: Function, reject: Function) => {
      this.getRequest().get(
        {
          url: '/files',
          json: true,
        },
        (err: Error, r: http.IncomingMessage, response: IFiles) => {
        if (r.statusCode !== 200) {
          return reject(err);
        }

        /*response.files = response.files.map((file: IFile) => {
          return file.fromPlain(file);
        });*/

        return resolve(response);
      });
    });
  }

  public createFiles(files: IFile[]): Promise<IFile[]> {
    return new Promise((resolve: Function, reject: Function) => {
      const filesToBeCreated = files.filter((file: IFile) => {
        if (file.file_id === null) {
          return true;
        } else {
          // TODO: test if file is still existing and not in trash at ioGates.
          return false;
        }
      });
      const fileData = filesToBeCreated.map((file: IFile) => {
        return {
          name: file.name,
          type: file.type,
          attributes: [{ name: 'path', value: file.stream_path }],
        };
      });

      this.getRequest().post(
        {
          url: '/files',
          json: true,
          body: { files: fileData },
        },
        (err: Error, r: http.IncomingMessage, response: IFiles) => {
          if (r.statusCode !== 200) {
            return reject(err);
          }
          const bulk = [];
          const createdFiles = files.map((file: IFile) => {
            const apiFile = _.find(response.files, { name: file.name });
            if (apiFile) {
              file.upload_filename = apiFile.upload_filename;
              file.file_id = apiFile.id;
              file.href = apiFile.href;
              file.download = apiFile.download;
              file.parent = apiFile.parent;
              file.type = apiFile.type;
              file.created = apiFile.created;

              bulk.push(file.save());
            }

            return file;
          });

          return Promise.all(bulk).then(() => {
            return resolve(createdFiles);
          });
      });
    });
  }

  public setToken(token: string) {
    this.token = token;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  public setApiUrlFromShareUrl(url: string) {
    this.setBaseUrl(`${IOGates.GET_BASE_URL(url)}/api`);
  }

  public getRequest() {
    const options = {
      baseUrl: this.baseUrl,
      headers: {
        token: '',
      },
    };
    if (this.token.length > 0) {
      options.headers.token = this.token;
    }

    return request.defaults(options);
  }
}
