const { chromium, selectors } = require("playwright")
const { format: dateFormat } = require("date-fns")
const fs = require("fs")
const path = require("path")
require("dotenv").config()



// Environment Variables
const userLogin: string = process.env.userLogin ?? process.exit(1)
const password: string = process.env.password ?? process.exit(1)
const secret: string = process.env.secret ?? process.exit(1)
const registrationUrl =
  "https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122578&xid=122578&xact=provisionnew"

// Main Function
async function main() {
  let page = await newPage()
  await login(page, userLogin, password)
  await page.goto(registrationUrl)
  await handleSecretWord(page, secret)

  while (true) {
    console.log(`-- Waiting for DOM...`)
    await page.waitForLoadState("domcontentloaded")
    console.log(`-- DOM Content loaded!`)

    console.log(`-- Checking current URL...`)
    console.log(`-- ${page.url()}`)

    console.log(`Compiling errors:`)
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

    console.log(`-- Collecting Question Elements...`)
    const questionsArray = await page
      .locator("selector=div.provisionbody.required")
      .all()

    console.log(`-- Reading errors...`)
    await Promise.all(
      [
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
      })
    )

    const errorsCombined = Object.entries(errors).reduce((carry, next) => {
      if (next[1]) {
        console.log(`-- ${next[0]}: ${next[1]}`)
        carry = carry ? `${carry}, ${next[0]}: ${next[1]}` : `${next[0]}: ${next[1]}`
        carry = carry.replace('\n', ' ').replace('"','\'')
      }
      return carry
    }, '')

    console.log(errorsCombined)

    await page.pause()

    console.log(`-- Submitting...`)
    await page.locator("selector=#submit").click()
  }
}

async function registerSelectorLocator() {
  // Must be a function that evaluates to a selector engine instance.
  const createSelectorNameEngine = () => ({
    // Returns the first element matching given selector in the root's subtree.
    query(root, selector) {
      return root.querySelector(selector)
    },

    // Returns all elements matching given selector in the root's subtree.
    queryAll(root, selector) {
      return Array.from(root.querySelectorAll(selector))
    },
  })

  // Register the engine. Selectors will be prefixed with "tag=".
  await selectors.register("selector", createSelectorNameEngine)
}

async function newPage() {
  await registerSelectorLocator()
  const browser = await chromium.launch({ headless: false, slowMo: 100 })
  return browser.newPage()
}

async function login(page, userLogin, password) {
  await page.goto("https://pharmoutcomes.org/pharmoutcomes/")
  await page
    .locator("selector=#login-form-elements input[name=login_name]")
    .fill(userLogin)
  await page
    .locator("selector=#login-form-elements input[name=login_pwd]")
    .fill(password)
  await page.locator("selector=#login-form-elements input[type=submit]").click()
  await page
    .getByRole("link", { name: "Stone Pharmacy (Meds2u Limited)" })
    .click()
}

async function handleSecretWord(page, secret: string) {
  if (!page.url().includes("passcode?enter")) {
    return
  }
  const firstSecretLetter = await page
    .locator("selector=form input[type=password]")
    .nth(0)
  const secondSecretLetter = await page
    .locator("selector=form input[type=password]")
    .nth(1)
  await firstSecretLetter.fill(await secretLetter(firstSecretLetter, secret))
  await secondSecretLetter.fill(await secretLetter(secondSecretLetter, secret))
  await page.getByRole("button", { name: "Submit" }).click()
}

async function secretLetter(secretLetterEl, secret: string): Promise<string> {
  const name = await secretLetterEl.getAttribute("name")
  const letterPosition: number = name.match(/[\w]+(\d)$/)[1]
  const letter = secret[letterPosition - 1]
  return letter
}

main()
