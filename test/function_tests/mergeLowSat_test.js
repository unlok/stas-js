const expect = require('chai').expect
const utils = require('../utils/test_utils')
const bsv = require('bsv')
require('dotenv').config()

const {
  contract,
  issue,
  split,
  merge,
  mergeWithCallback
} = require('../../index')

const {
  bitcoinToSatoshis,
  getTransaction,
  getFundsFromFaucet,
  broadcast
} = require('../../index').utils

const { sighash } = require('../../lib/stas')

let issuerPrivateKey
let fundingPrivateKey
let bobPrivateKey
let alicePrivateKey
let bobAddr
let aliceAddr
let contractUtxos
let fundingUtxos
let publicKeyHash
let splitTxid
let splitTx
let splitTxObj
let contractTxid
let contractTx
let issueTx
let issueTxid
const wait = 5000

const bobSignatureCallback = async (tx, i, script, satoshis) => {
  return bsv.Transaction.sighash.sign(tx, bobPrivateKey, sighash, i, script, satoshis).toTxFormat().toString('hex')
}
const paymentSignatureCallback = async (tx, i, script, satoshis) => {
  return bsv.Transaction.sighash.sign(tx, fundingPrivateKey, sighash, i, script, satoshis).toTxFormat().toString('hex')
}

beforeEach(async () => {
  await setup()
})

it('Merge - Successful Merge With Low Sats 1', async () => {
  const mergeHex = await merge(
    bobPrivateKey,
    utils.getMergeUtxo(splitTxObj),
    aliceAddr,
    utils.getUtxo(splitTxid, splitTx, 2),
    fundingPrivateKey
  )
  console.log(mergeHex)
  const mergeTxid = await broadcast(mergeHex)
  await new Promise(resolve => setTimeout(resolve, wait))
  const tokenIdMerge = await utils.getToken(mergeTxid)
  const response = await utils.getTokenResponse(tokenIdMerge)
  expect(response.symbol).to.equal('TAALT')
  expect(await utils.getVoutAmount(mergeTxid, 0)).to.equal(0.00007)
  await utils.isTokenBalance(aliceAddr, 7000)
  await utils.isTokenBalance(bobAddr, 3000)
})

async function setup () {
  issuerPrivateKey = bsv.PrivateKey()
  fundingPrivateKey = bsv.PrivateKey()
  bobPrivateKey = bsv.PrivateKey()
  alicePrivateKey = bsv.PrivateKey()
  bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()
  aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()
  contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
  fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())
  publicKeyHash = bsv.crypto.Hash.sha256ripemd160(issuerPrivateKey.publicKey.toBuffer()).toString('hex')
  const symbol = 'TAALT'
  const supply = 26
  const schema = utils.schema(publicKeyHash, symbol, supply)

  const contractHex = await contract(
    issuerPrivateKey,
    contractUtxos,
    fundingUtxos,
    fundingPrivateKey,
    schema,
    supply
  )
  contractTxid = await broadcast(contractHex)
  contractTx = await getTransaction(contractTxid)

  const issueHex = await issue(
    issuerPrivateKey,
    utils.getIssueInfo(aliceAddr, 16, bobAddr, 10),
    utils.getUtxo(contractTxid, contractTx, 0),
    utils.getUtxo(contractTxid, contractTx, 1),
    fundingPrivateKey,
    true,
    symbol,
    2
  )
  issueTxid = await broadcast(issueHex)
  issueTx = await getTransaction(issueTxid)

  const issueOutFundingVout = issueTx.vout.length - 1

  const bobAmount1 = issueTx.vout[0].value / 2
  const bobAmount2 = issueTx.vout[0].value - bobAmount1
  const splitDestinations = []
  splitDestinations[0] = { address: bobAddr, amount: bitcoinToSatoshis(bobAmount1) }
  splitDestinations[1] = { address: bobAddr, amount: bitcoinToSatoshis(bobAmount2) }

  const splitHex = await split(
    alicePrivateKey,
    utils.getUtxo(issueTxid, issueTx, 0),
    splitDestinations,
    utils.getUtxo(issueTxid, issueTx, issueOutFundingVout),
    fundingPrivateKey
  )
  splitTxid = await broadcast(splitHex)
  splitTx = await getTransaction(splitTxid)
  splitTxObj = new bsv.Transaction(splitHex)
}