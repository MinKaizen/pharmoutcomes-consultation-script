const { chromium, selectors } = require('playwright');
const args = require('yargs').argv;

async function main() {
  console.time('main')

  console.log('Hello world!')

  console.log('=========')
  console.log('END OF SCRIPT')
  console.log('=========')
  console.timeEnd('main')
  process.exit()
}

function parseArgs() {
  console.log('Checking script args...')
  const requiredArgs = ['input', 'username', 'password', 'secret']

  for (const argName of requiredArgs) {
    if (args[argName]) {
      console.log(`-- ${argName}: ${args[argName]}`)
    } else {
      console.log(`[${argName}] is missing from script args!`)
      console.log('Aborting...')
      process.exit()
    }
  }

  return args
}

main()