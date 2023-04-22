const { chromium, selectors } = require('playwright');
const { format: dateFormat } = require('date-fns');
const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createLogger, transports } = require('winston');
const { combine, printf } = require('winston').format;
require('dotenv').config();

interface RegistrationError {
  date: string;
  name: string;
  dob: string;
  gender: string;
  ethnicity: string;
  postcode: string;
  address: string;
  consent: string;
  gp: string;
}

interface ConsultationError {
  name: string;
  staffName: string;
  staffRole: string;
  referredBy: string;
  symptom: string;
  consultationTime: string;
  resource: string;
  purchasedOrSupplied: string;
  levyStatus: string;
  medication: string;
  quantity: string;
  secondMedication: string;
  referralNecessary: string;
}

interface PatientData {
  searchName: string;
  date: string;
  dob: string;
  staffName: string;
  staffRole: string;
  symptom: string;
  levyStatus: string;
  quantity: string;
  searchMedication: string;
  firstName: string;
  lastName: string;
  gender: string;
  postcode: string;
  address: string;
  practice: string;
  status?: string;
  time?: number;
}

// Script Args
const argv = yargs
  .option('dryrun', {
    description: 'Run without without submitting, but still write to output file',
    type: 'boolean',
    default: false
  })
  .option('pause', {
    description: 'Pause after before submitting data',
    type: 'boolean',
    default: false
  })
  .help()
  .alias('help', 'h')
  .alias('dryrun', 'd')
  .alias('pause', 'p')
  .argv;

// Environment Variables
const secret: string = process.env.secret ?? process.exit(1)
const userLogin: string = process.env.userLogin ?? process.exit(1)
const password: string = process.env.password ?? process.exit(1)
const inputFilePath: string = process.env.inputFilePath ?? process.exit(1)
const outputDir: string = process.env.outputDir ?? process.exit(1)

// Custom Errors
class PatientNotFoundError extends Error { }
class MedicineNotFoundError extends Error { }
class PatientRegisteredButNotFound extends Error { }
class QuantityError extends Error { }

// Constants
const consultationUrl = 'https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122581&xid=122581&xact=provisionnew'
const consultationErrorRedirect = 'services/enter/?xid=122581&xact=provisioncreate'
const registrationUrl = 'https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122578&xid=122578&xact=provisionnew'
const registrationErrorRedirect = 'pharmoutcomes/services/enter/?xid=122578&xact=provisioncreate'
const timestamp = dateFormat(new Date(), 'yyyy-MM-dd___HH-mm-ss')
const timeStartMilliseconds = Date.now()
const secondsElapsed = () => Math.round((Date.now() - timeStartMilliseconds) / 1000)
const logger = createLogger({
  format: combine(
    printf(info => {
      return `${info.message}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: `${outputDir}/${timestamp}.log` })
  ]
});


// Main Function
async function main() {
  if (!fs.existsSync(inputFilePath)) {
    logger.error(`File not found: ${inputFilePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const csvData: Array<PatientData> = await readInputFile(inputFilePath)
  let page = await newPage()
  await login(page, userLogin, password)

  for (let i = 0; i < csvData.length; i++) {
    try {
      await fillConsultation(page, csvData[i])
    } catch (e) {
      writeOutput(csvData[i], e.message.replace(/"/g, "'").replace(/\n/g, ' '))
    }
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

async function login(page, userLogin, password) {
  logger.info('Logging into Pharmoutcomes...')
  await page.goto('https://pharmoutcomes.org/pharmoutcomes/');
  await page.locator('selector=#login-form-elements input[name=login_name]').fill(userLogin)
  await page.locator('selector=#login-form-elements input[name=login_pwd]').fill(password)
  await page.locator('selector=#login-form-elements input[type=submit]').click()
  logger.info(`-- Switching to Meds2u account...`)
  await page.getByRole('link', { name: 'Stone Pharmacy (Meds2u Limited)' }).click()

  logger.info(``)
}

async function handleSecretWord(page, secret: string) {
  if (!page.url().includes('passcode?enter')) {
    return
  }
  logger.info(`Secret word required. Filling in...`)
  const firstSecretLetter = await page.locator('selector=form input[type=password]').nth(0)
  const secondSecretLetter = await page.locator('selector=form input[type=password]').nth(1)
  await firstSecretLetter.fill(await secretLetter(firstSecretLetter, secret))
  await secondSecretLetter.fill(await secretLetter(secondSecretLetter, secret))
  await page.getByRole('button', { name: 'Submit' }).click()
  logger.info(`-- Secret word submitted`)
}

async function secretLetter(secretLetterEl, secret: string): Promise<string> {
  const name = await secretLetterEl.getAttribute('name')
  const letterPosition: number = name.match(/[\w]+(\d)$/)[1]
  const letter = secret[letterPosition - 1]
  return letter
}

async function fillConsultation(page, data: PatientData, isAfterRegister = false) {
  logger.info(``)
  logger.info(`===============================`)
  logger.info(`Consultation for: ${data.searchName} (${data.dob})`)
  logger.info(`===============================`)
  logger.info(`Navigating to Consultations...`)
  await page.goto(consultationUrl);
  await handleSecretWord(page, secret)

  logger.info(`Filling in Consultation Data...`)
  logger.info(`-- Date: ${data.date}`)
  await page.getByLabel('Consultation date').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.date, { delay: 10 })
  await page.keyboard.press('Tab')

  logger.info(`-- Patient Name: ${data.searchName}`)
  await page.getByLabel('Patient name').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.searchName, { delay: 10 })

  logger.info(`-- Waiting for patient list...`)
  await page.locator('selector=#ui-id-1').first().click({ timeout: 10000, trial: true })

  try {
    await page.locator('selector=#ui-id-1 li a').filter({ hasText: data.dob }).first().click({ timeout: 3000 })
    logger.info(`-- Patient Found: ${data.searchName} (${data.dob})`)
  } catch (e) {
    logger.info(`-- Patient not found: ${data.searchName} (${data.dob})`)
    
    if (isAfterRegister) {
      throw new PatientRegisteredButNotFound('Patient was registered but not found in the database')
    }

    await fillRegistration(page, data)

    if (argv.dryrun) {
      writeOutput(data, 'New patient registered')
    } else {
      await fillConsultation(page, data, true)
    }

    return
  }
  logger.info(`-- Staff member's name: ${data.staffName}`)
  await page.getByLabel('Staff Member\'s Name').fill(data.staffName)

  logger.info(`-- Staff role: ${data.staffRole}`)
  await page.getByRole('group', { name: 'Pharmacy Staff Role' }).getByLabel('OtherIf Other please state').click()
  await page.locator('input[name="ctrlRadio_867970_Other"]').fill(data.staffRole)

  logger.info(`-- Referral Type: Patient self access`)
  await page.getByLabel('Patient self access').click()

  logger.info(`-- Symptom: ${data.symptom}`)
  await page.getByRole('combobox', { name: 'Presenting symptoms' }).selectOption(data.symptom)

  logger.info(`-- Consulation Time: Up to 10 minutes`)
  await page.getByLabel('Up to 10 minutes').click()

  logger.info(`-- Type: Patient has been supplied medicine under the service`)
  await page.getByLabel('Patient has been supplied medicine under the service').click()

  logger.info(`-- Levy Status: ${data.levyStatus}`)
  await page.getByRole('combobox', { name: 'Levy Status' }).selectOption(data.levyStatus)

  logger.info(`-- Referral Advice: no`)
  await page.getByRole('group', { name: 'Referral Advice' }).getByLabel('No', { exact: true }).click()

  logger.info(`-- Resources provided: Other: None`)
  await page.getByRole('radio', { name: 'Other If other please state', exact: true }).click()
  await page.locator('input[name="ctrlRadio_867460_Other"]').fill('None')

  logger.info(`-- Medication: ${data.searchMedication}`)
  await page.getByLabel('Medication supplied', { exact: true }).click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.searchMedication, { delay: 10 })

  logger.info(`-- Waiting for medication popup...`)
  await page.locator('selector=#ui-id-2').first().click({ timeout: 10000, trial: true })

  try {
    logger.info(`-- Selecting Medication...`)
    await page.locator('selector=#ui-id-2 li a').first().click({ timeout: 3000 })
    logger.info(`-- Medication Selected!`)
  } catch (e) {
    logger.info(`-- Medication not found: ${data.searchMedication}`)
    throw new MedicineNotFoundError(`Medicine not found`)
  }

  logger.info(`-- Quantity: ${data.quantity}`)
  await page.getByRole('textbox', { name: 'Quantity' }).fill(data.quantity)

  try {
    logger.info(`-- Waiting for quantity error...`)
    await page.locator('#ctrlLookup_115624_QuantityErr').click({trial: true, timeout: 1000})
    logger.info(`-- Quantity Error. Aborting...`)
    throw new QuantityError('Quantity Error')
  } catch (e) {
    // No Quantity Error. Continue...
    logger.info(`-- Success! No quantity errors`)
  }

  logger.info(`-- 2nd medicine supplied: No`)
  await page.getByRole('group', { name: 'Medication' }).getByLabel('No').click()

  if (argv.pause) {
    await page.pause()
  }

  if (argv.dryrun) {
    logger.info(`-- Dry run, not submitting...`)
  } else {
    logger.info(`-- Submitting...`)
    await page.getByRole('button', { name: 'Save' }).click()

    logger.info(`-- Waiting for DOM...`)
    await page.waitForLoadState('domcontentloaded')
    logger.info(`-- DOM Content loaded!`)

    logger.info(`-- Checking current URL...`)    
    if (page.url().includes(consultationErrorRedirect)) {
      logger.info(`-- Redirected back to consultation page! (Submission failed)`)
      const errors = await consultationErrors(page)
      const errorsCombined = Object.entries(errors).reduce((carry, next) => {
        if (next[1]) {
          logger.info(`-- ${next[0]}: ${next[1]}`)
          carry = carry ? `${carry}, ${next[0]}: ${next[1]}` : `${next[0]}: ${next[1]}`
          carry = carry.replace('\n', ' ').replace('"','\'')
        }
        return carry
      }, '')
      throw new Error(`Consultation Form Failed: ${errorsCombined}`)
    }
  }

  logger.info(`-- Success!`)
  writeOutput(data, 'Success')
}

async function consultationErrors(page): Promise<ConsultationError> {
  logger.info(``)
  logger.info(`Compiling errors:`)
  let errors: ConsultationError = {
    name: '',
    staffName: '',
    staffRole: '',
    referredBy: '',
    symptom: '',
    consultationTime: '',
    resource: '',
    purchasedOrSupplied: '',
    levyStatus: '',
    medication: '',
    quantity: '',
    secondMedication: '',
    referralNecessary: '',
  }
  
  logger.info(`-- Collecting Question Elements...`)
  const questionsArray = await page.locator('selector=div.provisionquestion div.provisionbody.required').all()

  logger.info(`-- Reading errors...`)
  await Promise.all([
    {name: 'name', question: questionsArray[0]},
    {name: 'staffName', question: questionsArray[1]},
    {name: 'staffRole', question: questionsArray[2]},
    {name: 'referredBy', question: questionsArray[3]},
    {name: 'symptom', question: questionsArray[4]},
    {name: 'consultationTime', question: questionsArray[5]},
    {name: 'resource', question: questionsArray[6]},
    {name: 'purchasedOrSupplied', question: questionsArray[7]},
    {name: 'levyStatus', question: questionsArray[8]},
    {name: 'medication', question: questionsArray[9]},
    {name: 'quantity', question: questionsArray[10]},
    {name: 'secondMedication', question: questionsArray[11]},
    {name: 'referralNecessary', question: questionsArray[17]},
  ].map(async (obj) => {
    if (await obj.question.locator('selector=p.error').isVisible()) {
      errors[obj.name] = await obj.question.locator('selector=p.error').innerText()
    }
  }))

  return errors
}

async function fillRegistration(page, data: PatientData) {
  logger.info(``)
  logger.info(`===============================`)
  logger.info(`Registration for: ${data.firstName} ${data.lastName} (${data.dob})`)
  logger.info(`===============================`)
  logger.info(`Navigating to Registration...`)
  await page.goto(registrationUrl)
  await handleSecretWord(page, secret)

  logger.info(`Filling in registration data...`)
  logger.info(`Provision date: ${data.date}`)
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

  logger.info(`-- Name: ${data.firstName} ${data.lastName}`)
  await page.getByLabel('Name').fill(`${data.firstName} ${data.lastName}`)

  logger.info(`-- Date of Birth: ${data.dob}`)
  await page.getByLabel('Date of Birth').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.dob, { delay: 10 })
  try {
    await page.locator('selector=#ui-datepicker-div').first().click({ timeout: 1000, trial: true })
  } catch (e) {
    // Continue
  }
  await page.keyboard.press('Tab')

  if (data.gender == 'Male') {
    logger.info(`Gender: Male`)
    await page.getByLabel('Male', { exact: true }).click()
  } else if (data.gender == 'Female') {
    logger.info(`Gender: Female`)
    await page.getByLabel('Female').click()
  } else {
    logger.info(`Gender: Trans`)
    await page.getByLabel('Trans').click()
  }
  
  logger.info(`Ethnicity: Not stated`)
  await page.getByRole('combobox', { name: 'Ethnicity' }).selectOption('Not stated')

  logger.info(`-- Postcode: ${data.postcode}`)
  await page.getByLabel('Postcode').fill(data.postcode)
  
  logger.info(`-- Address: ${data.address}`)
  await page.getByLabel('Address').fill(data.address)
  
  logger.info(`-- Consent Obtained: Yes`)
  await page.getByLabel('Yes').click()

  logger.info(`-- GP Practice: ${data.practice}`)
  await page.getByLabel('GP Practice').click()
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.type(data.practice, { delay: 10 })
  logger.info(`-- Waiting for practice popup...`)
  await page.locator('selector=#ui-id-3').first().click({ timeout: 10000, trial: true })
  logger.info(`-- Selecting Practice...`)
  await page.locator('selector=#ui-id-3 li a').first().click({ timeout: 3000 })
  logger.info(`-- Practice Selected!`)

  if (argv.pause) {
    await page.pause()
  }

  if (argv.dryrun) {
    logger.info(`-- Dry run, not submitting...`)
  } else {
    logger.info(`-- Submitting...`)
    await page.locator('selector=#submit').click()
    logger.info(`-- Waiting for DOM...`)
    await page.waitForLoadState("domcontentloaded")
    logger.info(`-- DOM Content loaded!`)

    logger.info(`-- Checking current URL...`)
    logger.info(`-- ${page.url()}`)
    if (page.url().includes(registrationErrorRedirect)) {
      logger.info(`-- Redirected back to registration page! (Submission failed)`)
      const errors = await registrationErrors(page)
      const errorsCombined = Object.entries(errors).reduce((carry, next) => {
        if (next[1]) {
          logger.info(`-- ${next[0]}: ${next[1]}`)
          carry = carry ? `${carry}, ${next[0]}: ${next[1]}` : `${next[0]}: ${next[1]}`
          carry = carry.replace('\n', ' ').replace('"','\'')
        }
        return carry
      }, '')
      throw new Error(`Registration Form Failed: ${errorsCombined}`)
    }
    
  }

  logger.info(`-- Success!`)
}

async function registrationErrors(page): Promise<RegistrationError> {
  logger.info(`Compiling errors:`)
  let errors: RegistrationError = {
    date: '',
    name: '',
    dob: '',
    gender: '',
    ethnicity: '',
    postcode: '',
    address: '',
    consent: '',
    gp: '',
  }

  logger.info(`-- Collecting Question Elements...`)
  const questionsArray = await page.locator("selector=div.provisionbody.required").all()

  logger.info(`-- Reading errors...`)
  await Promise.all([
    { name: "date", question: questionsArray[0] },
    { name: "name", question: questionsArray[1] },
    { name: "dob", question: questionsArray[2] },
    { name: "gender", question: questionsArray[3] },
    { name: "ethnicity", question: questionsArray[4] },
    { name: "postcode", question: questionsArray[5] },
    { name: "address", question: questionsArray[6] },
    { name: "consent", question: questionsArray[7] },
    { name: "gp", question: questionsArray[8] },
  ].map(async (obj) => {
    if (await obj.question.locator("selector=p.error").isVisible()) {
      errors[obj.name] = await obj.question
        .locator("selector=p.error")
        .innerText()
    }
  }))

  return errors
}

function writeOutput(data: PatientData, status: string =''): void {
  data.status = status
  data.time = secondsElapsed()

  const filePath = path.join(outputDir, `${timestamp}.csv`);

  if (!fs.existsSync(filePath)) {
    const header = Object.keys(data).join(',');
    fs.writeFileSync(filePath, `${header}\n`);
  }

  const keys = Object.keys(data);
  const values = keys.map((key) => typeof data[key] === 'string' ? `"${data[key]}"` : data[key]);
  const line = values.join(',');
  fs.appendFileSync(filePath, `${line}\n`);
}

main()