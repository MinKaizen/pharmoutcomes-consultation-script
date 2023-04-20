const { chromium, selectors } = require('playwright');
const args = require('yargs').argv;
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config();

class PatientNotFoundError extends Error { }
class MedicineNotFoundError extends Error { }

const timestamp = getTimestamp()
const timeStartMilliseconds = Date.now()
const secondsElapsed = () => Math.round((Date.now() - timeStartMilliseconds) / 1000)

async function main() {
  console.time('main')

  if (!fs.existsSync(process.env.inputFilePath)) {
    console.error(`File not found: ${process.env.inputFilePath}`);
    process.exit(1);
  }

  const csvData = await readInputFile(process.env.inputFilePath)
  let toRegister: Array<Object> = []
  let page = await newPage()
  await login(page, process.env.username, process.env.password)

  // Round 1: Fill in all the consultations, 
  // note down any patients that need registering
  for (let i = 0; i < csvData.length; i++) {
    toRegister.push(csvData[i])
    try {
      await fillConsultation(page, csvData[i])
      writeOutput(timestamp, { ...csvData[i], status: 'Success' })
    } catch (e) {
      if (e instanceof PatientNotFoundError) {
        console.log(`Could not find patient:`)
        console.log(`-- ${csvData[i].searchName} (${csvData[i].dob})`)
        toRegister.push(csvData[i])
        console.log(`(added to list of patients to register later...)`)
        console.log(``)
      } else if (e instanceof MedicineNotFoundError) {
        bigError(`Could not find medicine: ${csvData[i].searchMedication}`)
        console.log(`Skipping row ${i}...`)
        writeOutput(timestamp, { ...csvData[i], status: 'Medicine not found' })
        console.log(``)
      } else {
        bigError(e)
      }
    }
    await page.pause()
  }

  // Round 2: Register all the patients that need registering
  for (let data of toRegister) {
    try {
      await fillRegistration(page, data)
      await fillConsultation(page, data)
    } catch (e) {
      bigError(e)
    }
    await page.pause()
  }

}

async function readInputFile(filepath) {
  const csvData: any[] = await new Promise((resolve, reject) => {
    const data: any[] = [];
    fs.createReadStream(filepath)
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

  return csvData
}

function bigError(e) {
  console.error(`==============================`)
  console.error(`=============ERROR============`)
  console.error(e)
  console.error(`=============ERROR============`)
  console.error(`==============================`)
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

async function handleSecretWord(page, secret) {
  if (!page.url().includes('passcode?enter')) {
    return
  }
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
  console.log(`Navigating to Consultations...`)
  await page.goto('https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122581&xid=122581&xact=provisionnew');
  await handleSecretWord(page, process.env.secret)

  console.log(`Filling in consultation for ${data.searchName}...`)
  console.log(`-- Date: ${data.date}`)
  await page.getByLabel('Consultation date').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.date, { delay: 10 })
  try {
    await page.getByText('PrevNextMarch 2023SuMoTuWeThFrSa 12345678910111213141516171819202122232425262728').waitForElementState('visible', { timeout: 2000 })
  } catch (e) {
    // Date picker not visible, continue
  }
  await page.keyboard.press('Tab')

  console.log(`-- Patient Name: ${data.searchName}`)
  await page.getByLabel('Patient name').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.searchName, { delay: 10 })

  console.log(`-- Waiting for patient list...`)
  await page.locator('selector=#ui-id-1').first().click({ timeout: 10000, trial: true })

  try {
    console.log(`-- Selecting patient...`)
    await page.locator('selector=#ui-id-1 li a').filter({ hasText: data.dob }).first().click({ timeout: 3000 })
    console.log(`-- Patient Found: ${data.searchName}`)
  } catch (e) {
    console.log(e)
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

  console.log(`-- Medication: ${data.searchMedication}`)
  await page.getByLabel('Medication supplied', { exact: true }).click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.searchMedication, { delay: 10 })

  console.log(`-- Waiting for medication popup...`)
  await page.locator('selector=#ui-id-2').first().click({ timeout: 10000, trial: true })

  try {
    console.log(`-- Selecting Medication...`)
    await page.locator('selector=#ui-id-2 li a').first().click({ timeout: 3000 })
    console.log(`-- Medication Selected!`)
  } catch (e) {
    console.log(e)
    throw new MedicineNotFoundError(`Could not find medicine: ${data.searchMedication}`)
  }
  // await page.getByRole('button', { name: 'Save' }).click()
}

async function fillRegistration(page, data) {
  console.log(`Navigating to Registration...`)
  await page.goto('https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122578&xid=122578&xact=provisionnew')
  await handleSecretWord(page, process.env.secret)

  console.log(`Filling in registration for ${data.firstName} ${data.lastName}...`)
  await page.getByLabel('Provision Date').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.date, { delay: 10 })
  try {
    await page.locator('selector=#ui-datepicker-div').first().click({ timeout: 1000, trial: true })
  } catch (e) {
    // Continue
  }
  await page.keyboard.press('Tab')

  console.log(`-- Name: ${data.firstName} ${data.lastName}`)
  await page.getByLabel('Name').fill(`${data.firstName} ${data.lastName}`)

  console.log(`-- Date of Birth: ${data.date}`)
  await page.getByLabel('Date of Birth').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.date, { delay: 10 })
  try {
    await page.locator('selector=#ui-datepicker-div').first().click({ timeout: 1000, trial: true })
  } catch (e) {
    // Continue
  }
  await page.keyboard.press('Tab')

  if (data.gender == 'Male') {
    console.log(`Gender: Male`)
    await page.getByLabel('Male', { exact: true }).click()
  } else if (data.gender == 'Female') {
    console.log(`Gender: Female`)
    await page.getByLabel('Female').click()
  } else {
    console.log(`Gender: Trans`)
    await page.getByLabel('Trans').click()
  }
  
  console.log(`Ethnicity: Not stated`)
  await page.getByRole('combobox', { name: 'Ethnicity' }).selectOption('Not stated')

  console.log(`-- Postcode: ${data.postcode}`)
  await page.getByLabel('Postcode').fill(data.postcode)
  
  console.log(`-- Address: ${data.address}`)
  await page.getByLabel('Address').fill(data.address)
  
  console.log(`-- Consent Obtained: Yes`)
  await page.getByLabel('Yes').click()

  console.log(`-- Entering GP Practice...`)
  await page.getByLabel('GP Practice').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.practice, { delay: 10 })
  console.log(`-- Waiting for practice popup...`)
  await page.locator('selector=#ui-id-3').first().click({ timeout: 10000, trial: true })
  console.log(`-- Selecting Practice...`)
  await page.locator('selector=#ui-id-3 li a').first().click({ timeout: 3000 })
  console.log(`-- Practice Selected!`)

  console.log(`-- Save and enter another: yes`)
  await page.getByLabel('Save and enter another').click()

  // await page.locator('selector=#submit').click()
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
  }
  const keys = Object.keys(data);
  const values = keys.map((key) => typeof data[key] === 'string' ? `"${data[key]}"` : data[key]);
  const line = values.join(',');
  fs.appendFileSync(filePath, `${line}\n`);
}

function getTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-');
}

main()