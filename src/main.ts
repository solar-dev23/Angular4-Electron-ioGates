import * as vorpal from 'vorpal';
import { downloadComand } from './commands/download';

import { Sequelize } from 'sequelize-typescript';
const sequelize = new Sequelize({
  name: 'iogates',
  dialect: 'sqlite',
  username: 'root',
  password: '',
  storage: `${__dirname}/iogates.sqlite`,
  modelPaths: [`${__dirname}/types/models`]
});
console.log(sequelize);
const commands = vorpal();
commands
  .command('download [dir] [url]', 'Download folder from Share URL')
  .option('-m', '--monitor', 'Shows download progress')
  .action(downloadComand);
commands
  .delimiter('iogates>')
  .show()
  .parse(process.argv);
commands.commands = commands.commands;

module.exports = commands;
