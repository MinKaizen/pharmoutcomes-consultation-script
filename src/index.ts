const { chromium, selectors } = require('playwright');
const args = require('yargs').argv;
const fs = require('fs');
const csv = require('csv-parser');

async function main() {
  console.time('main')

  const filePath = 'inputs/data.csv';

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  // Parse the CSV data into an array of objects using the csv-parser package
  const csvData: any[] = [];

  // Use the csv-parser package to parse the CSV data
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => {
      // Create an object for each row of data
      const row = {};
      for (const key in data) {
        // Use the column names as keys and the row values as values
        row[key] = data[key];
      }
      // Add the object to the csvData array
      csvData.push(row);
      console.log(row)
    })
    
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