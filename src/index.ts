const { chromium, selectors } = require('playwright');
const args = require('yargs').argv;
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

class PatientNotFoundError extends Error {}
class MedicineNotFoundError extends Error {}

const timestamp = getTimestamp()

async function main() {
  console.time('main')

  if (!fs.existsSync(process.env.inputFilePath)) {
    console.error(`File not found: ${process.env.inputFilePath}`);
    process.exit(1);
  }

  let page = await newPage()
  await login(page, process.env.username, process.env.password)
  await goToConsultations(page)

  if (page.url().includes('passcode?enter')) {
    await handleSecretWord(page, process.env.secret)
  }

  // Parse the CSV data into an array of objects using the csv-parser package
  const csvData: any[] = await new Promise((resolve, reject) => {
    const data: any[] = [];
    fs.createReadStream(process.env.inputFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // Create an object for each row of data
        const obj = {};
        for (const key in row) {
          // Use the column names as keys and the row values as values
          obj[key] = row[key];
        }
        // Add the object to the data array
        data.push(obj);
      })
      .on('end', () => {
        // Resolve the Promise with the fully populated data array
        resolve(data);
      })
      .on('error', (error) => {
        // Reject the Promise with the error
        reject(error);
      });
  });

  for (let i=0; i < csvData.length; i++) {
    try {
      await fillConsultation(page, csvData[i])
      writeOutput(timestamp, {...csvData[i], status: 'Success'})
    } catch (e) {
      if (e instanceof PatientNotFoundError) {
        console.error(`==============================`)
        console.error(`=============ERROR============`)
        console.error(`Could not find patient: ${csvData[i].searchName}`)
        console.error(`=============ERROR============`)
        console.error(`==============================`)
        await page.pause()
        console.log(`Skipping row ${i}...`)
        writeOutput(timestamp, {...csvData[i], status: 'Name not found'})
        console.log(``)
        continue
      } else if (e instanceof MedicineNotFoundError) {
        console.error(`==============================`)
        console.error(`=============ERROR============`)
        console.error(`Could not find medicine: ${csvData[i].searchMedication}`)
        console.error(`=============ERROR============`)
        console.error(`==============================`)
        await page.pause()
        console.log(`Skipping row ${i}...`)
        writeOutput(timestamp, {...csvData[i], status: 'Medicine not found'})
        console.log(``)
        continue
      }
    }
    await page.pause()
  }
}

async function registerSelectorLocator() {
  // Must be a function that evaluates to a selector engine instance.
  const createSelectorNameEngine = () => ({
    // Returns the first element matching given selector in the root's subtree.
    query(root, selector) {
      return root.querySelector(selector);
    },

    // Returns all elements matching given selector in the root's subtree.
    queryAll(root, selector) {
      return Array.from(root.querySelectorAll(selector));
    }
  });

  // Register the engine. Selectors will be prefixed with "tag=".
  await selectors.register('selector', createSelectorNameEngine);
}

async function newPage() {
  await registerSelectorLocator()
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  return browser.newPage()
}

async function login(page, username, password) {
  console.log('Logging into Pharmoutcomes...')
  await page.goto('https://pharmoutcomes.org/pharmoutcomes/');
  await page.locator('selector=#login-form-elements input[name=login_name]').fill(username)
  await page.locator('selector=#login-form-elements input[name=login_pwd]').fill(password)
  await page.locator('selector=#login-form-elements input[type=submit]').click()
  console.log(`-- Switching to Meds2u account...`)
  await page.getByRole('link', { name: 'Stone Pharmacy (Meds2u Limited)' }).click()

  console.log(``)
}

async function goToConsultations(page) {
  console.log(`Navigating to Consultations...`)
  await page.goto('https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122581&xid=122581&xact=provisionnew');
  console.log(``)
}

async function handleSecretWord(page, secret) {
  console.log(`Filling in Secret Letters...`)
  const firstSecretLetter = await page.locator('selector=form input[type=password]').nth(0)
  const secondSecretLetter = await page.locator('selector=form input[type=password]').nth(1)
  await firstSecretLetter.fill(await secretLetter(firstSecretLetter, secret))
  await secondSecretLetter.fill(await secretLetter(secondSecretLetter, secret))
  await page.getByRole('button', { name: 'Submit' }).click()
  console.log(``)
}

async function secretLetter(secretLetterEl, secret): Promise<string> {
  const name = await secretLetterEl.getAttribute('name')
  const letterPosition: number = name.match(/[\w]+(\d)$/)[1]
  const letter = secret[letterPosition - 1]
  return letter
}

async function fillConsultation(page, data) {
  console.log(`Filling in consultation for ${data.searchName}...`)
  await page.getByLabel('Consultation date').fill(data.date)
  console.log(`-- Date: ${data.date}`)
  await page.getByLabel('Consultation date').click()
  await page.getByLabel('Consultation date').blur()

  try {
    console.log(`-- Closing date picker...`)
    await page.locator('selector=#ui-datepicker-div').click({timeout: 1000})
    await page.getByLabel('Patient self access').click()
  } catch (e) {
    console.log(`-- Date picker already closed`)
  }

  console.log(`-- Patient Name: ${data.searchName}`)
  await page.getByLabel('Patient name').click()
  await page.getByLabel('Patient name').fill(data.searchName)

  try {
    console.log(`-- Waiting for patient list...`)
    await page.locator('selector=#ui-id-1')
    console.log(`-- Patient List opened!`)
    await page.locator('selector=#ui-id-1 li a').filter({ hasText: data.dob }).first().click()
    console.log(`-- Selecting patient: ${data.searchName}`)
  } catch (e) {
    throw new PatientNotFoundError(`Could not find patient: ${data.searchName}`)
  }
  console.log(`-- Patient found: ${data.searchName}`)

  console.log(`-- Staff member's name: ${data.staffName}`)
  await page.getByLabel('Staff Member\'s Name').fill(data.staffName)

  console.log(`-- Staff role: ${data.staffRole}`)
  await page.getByRole('group', { name: 'Pharmacy Staff Role' }).getByLabel('OtherIf Other please state').click()
  await page.locator('input[name="ctrlRadio_867970_Other"]').fill(data.staffRole)

  console.log(`-- Referral Type: Patient self access`)
  await page.getByLabel('Patient self access').click()

  console.log(`-- Symptom: ${data.symptom}`)
  await page.getByRole('combobox', { name: 'Presenting symptoms' }).selectOption(data.symptom)

  console.log(`-- Selecting: Up to 10 minutes`)
  await page.getByLabel('Up to 10 minutes').click()

  console.log(`-- Selecting: Patient has been supplied medicine under the service`)
  await page.getByLabel('Patient has been supplied medicine under the service').click()

  console.log(`-- Levy Status: ${data.levyStatus}`)
  await page.getByRole('combobox', { name: 'Levy Status' }).selectOption(data.levyStatus)

  console.log(`-- Quantity: ${data.quantity}`)
  await page.getByRole('textbox', { name: 'Quantity' }).fill(data.quantity)

  console.log(`-- Referral Advice: no`)
  await page.getByRole('group', { name: 'Referral Advice' }).getByLabel('No', { exact: true }).click()

  console.log(`-- Save and enter another: yes`)
  await page.getByLabel('Save and enter another').click()
  try {
    console.log(`-- Medication: ${data.searchMedication}`)
    await page.getByLabel('Medication supplied', { exact: true }).click()
    await page.getByLabel('Medication supplied', { exact: true }).fill(data.searchMedication)
    console.log(`-- Waiting for medication popup...`)
    await page.locator('selector=#ui-id-2')
    console.log(`-- Medication Popup Opened!`)
    await page.locator('selector=#ui-id-2 li a').first().click()
    console.log(`-- Medication Selected!`)
    await page.pause()
  } catch (e) {
    throw new MedicineNotFoundError(`Could not find medicine: ${data.searchMedication}`)
  }
  // await page.getByRole('button', { name: 'Save' }).click()
}

function writeOutput(timestamp: string, data): void {
  if (!data.hasOwnProperty('status')) {
    data.status = '';
  }

  const filePath = path.join('outputs', `${timestamp}.csv`);

  if (!fs.existsSync('outputs')) {
    fs.mkdirSync('outputs');
  }

  const fileExists = fs.existsSync(filePath);

  if (!fileExists) {
    const header = Object.keys(data).join(',');
    fs.writeFileSync(filePath, `${header}\n`);
    const keys = Object.keys(data);
    const values = keys.map((key) => data[key]);
    const line = values.join(',');
    fs.appendFileSync(filePath, `${line}\n`);
  }

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('end', () => {
      const keys = Object.keys(data);
      const values = keys.map((key) => data[key]);
      const line = values.join(',');
      fs.appendFileSync(filePath, `${line}\n`);
    });
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-');
}

main()