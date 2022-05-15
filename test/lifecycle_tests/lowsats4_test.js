const expect = require('chai').expect
const utils = require('../utils/test_utils')

const bsv = require('bsv')
require('dotenv').config()

const {
  contract,
  issue,
  transfer,
  split,
  merge,
  mergeSplit,
  redeem
} = require('../../index')

const {
  bitcoinToSatoshis,
  getTransaction,
  getFundsFromFaucet,
  broadcast
} = require('../../index').utils

describe('regression, testnet', () => {
  it('Full Life Cycle Test Low Sats 3', async () => {
    const issuerPrivateKey = bsv.PrivateKey()
    const fundingPrivateKey = bsv.PrivateKey()

    const alicePrivateKey = bsv.PrivateKey()
    const aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()

    const bobPrivateKey = bsv.PrivateKey()
    const bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()

    const contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
    const fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())

    const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(issuerPrivateKey.publicKey.toBuffer()).toString('hex')
    const supply = 3
    const symbol = 'TAALT'
    const schema = utils.schema(publicKeyHash, symbol, supply)
    const wait = 5000

    // change goes back to the fundingPrivateKey
    const contractHex = contract(
      issuerPrivateKey,
      contractUtxos,
      fundingUtxos,
      fundingPrivateKey,
      schema,
      supply
    )
    const contractTxid = await broadcast(contractHex)
    console.log(`Contract TX:     ${contractTxid}`)
    const contractTx = await getTransaction(contractTxid)

    const issueHex = issue(
      issuerPrivateKey,
      utils.getIssueInfo(aliceAddr, 1, bobAddr, 2),
      utils.getUtxo(contractTxid, contractTx, 0),
      utils.getUtxo(contractTxid, contractTx, 1),
      fundingPrivateKey,
      true,
      symbol,
      2
    )
    const issueTxid = await broadcast(issueHex)
    const issueTx = await getTransaction(issueTxid)
    await new Promise(resolve => setTimeout(resolve, wait))
    const tokenId = await utils.getToken(issueTxid)
    const response = await utils.getTokenResponse(tokenId)
    expect(response.symbol).to.equal(symbol)
    expect(await utils.getVoutAmount(issueTxid, 0)).to.equal(0.00000001)
    expect(await utils.getVoutAmount(issueTxid, 1)).to.equal(0.00000002)
    await utils.isTokenBalance(aliceAddr, 1)
    await utils.isTokenBalance(bobAddr, 2)

    const issueOutFundingVout = issueTx.vout.length - 1

    const transferHex = transfer(
      bobPrivateKey,
      utils.getUtxo(issueTxid, issueTx, 1),
      aliceAddr,
      utils.getUtxo(issueTxid, issueTx, issueOutFundingVout),
      fundingPrivateKey
    )
    const transferTxid = await broadcast(transferHex)
    console.log(`Transfer TX:     ${transferTxid}`)
    const transferTx = await getTransaction(transferTxid)
    expect(await utils.getVoutAmount(transferTxid, 0)).to.equal(0.00000002)
    await utils.isTokenBalance(aliceAddr, 3)
    await utils.isTokenBalance(bobAddr, 0)

    // Split tokens into 2 - both payable to Bob...
    const bobAmount1 = transferTx.vout[0].value / 2
    const bobAmount2 = transferTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, amount: bitcoinToSatoshis(bobAmount1) }
    splitDestinations[1] = { address: bobAddr, amount: bitcoinToSatoshis(bobAmount2) }

    const splitHex = split(
      alicePrivateKey,
      utils.getUtxo(transferTxid, transferTx, 0),
      splitDestinations,
      utils.getUtxo(transferTxid, transferTx, 1),
      fundingPrivateKey
    )
    const splitTxid = await broadcast(splitHex)
    console.log(`Split TX:        ${splitTxid}`)
    const splitTx = await getTransaction(splitTxid)
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.00000001)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.00000001)
    await utils.isTokenBalance(aliceAddr, 1)
    await utils.isTokenBalance(bobAddr, 2)

    // Now let's merge the last split back together
    const splitTxObj = new bsv.Transaction(splitHex)
    console.log('splitobj ' + splitTxObj.toString())

    const mergeHex = merge(
      bobPrivateKey,
      utils.getMergeUtxo(splitTxObj),
      aliceAddr,
      utils.getUtxo(splitTxid, splitTx, 2),
      fundingPrivateKey
    )
    console.log(mergeHex)
    const mergeTxid = await broadcast(mergeHex)
    console.log(`Merge TX:        ${mergeTxid}`)
    const mergeTx = await getTransaction(mergeTxid)
    expect(await utils.getVoutAmount(mergeTxid, 0)).to.equal(0.00000002)
    await utils.isTokenBalance(aliceAddr, 3)
    await utils.isTokenBalance(bobAddr, 0)

    // Split again - both payable to Alice...
    const aliceAmount1 = mergeTx.vout[0].value / 2
    const aliceAmount2 = mergeTx.vout[0].value - aliceAmount1

    const split2Destinations = []
    split2Destinations[0] = { address: bobAddr, amount: bitcoinToSatoshis(aliceAmount1) }
    split2Destinations[1] = { address: bobAddr, amount: bitcoinToSatoshis(aliceAmount2) }

    const splitHex2 = split(
      alicePrivateKey,
      utils.getUtxo(mergeTxid, mergeTx, 0),
      split2Destinations,
      utils.getUtxo(mergeTxid, mergeTx, 1),
      fundingPrivateKey
    )
    const splitTxid2 = await broadcast(splitHex2)
    console.log(`Split TX2:       ${splitTxid2}`)
    const splitTx2 = await getTransaction(splitTxid2)
    expect(await utils.getVoutAmount(splitTxid2, 0)).to.equal(0.00000001)
    expect(await utils.getVoutAmount(splitTxid2, 1)).to.equal(0.00000001)
    await utils.isTokenBalance(aliceAddr, 1)
    await utils.isTokenBalance(bobAddr, 2)

    // Now mergeSplit
    const splitTxObj2 = new bsv.Transaction(splitHex2)

    const bobAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value)
    const aliceAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[1].value)

    const mergeSplitHex = mergeSplit(
      bobPrivateKey,
      utils.getMergeSplitUtxo(splitTxObj2, splitTx2),
      aliceAddr,
      aliceAmountSatoshis,
      bobAddr,
      bobAmountSatoshis,
      utils.getUtxo(splitTxid2, splitTx2, 2),
      fundingPrivateKey
    )
    const mergeSplitTxid = await broadcast(mergeSplitHex)
    console.log(`MergeSplit TX:   ${mergeSplitTxid}`)
    const mergeSplitTx = await getTransaction(mergeSplitTxid)
    expect(await utils.getVoutAmount(mergeSplitTxid, 0)).to.equal(0.00000001)
    expect(await utils.getVoutAmount(mergeSplitTxid, 1)).to.equal(0.00000001)
    await utils.isTokenBalance(aliceAddr, 2)
    await utils.isTokenBalance(bobAddr, 1)

    const redeemHex = redeem(
      alicePrivateKey,
      issuerPrivateKey.publicKey,
      utils.getUtxo(mergeSplitTxid, mergeSplitTx, 0),
      utils.getUtxo(mergeSplitTxid, mergeSplitTx, 1),
      fundingPrivateKey
    )
    const redeemTxid = await broadcast(redeemHex)
    console.log(`Redeem TX:       ${redeemTxid}`)
    const redeemTx = await getTransaction(redeemTxid)
    expect(await utils.getVoutAmount(redeemTxid, 0)).to.equal(0.00000001)
    await utils.isTokenBalance(aliceAddr, 1)
    await utils.isTokenBalance(bobAddr, 1)

    const redeemHex2 = redeem(
      alicePrivateKey,
      issuerPrivateKey.publicKey,
      utils.getUtxo(issueTxid, issueTx, 0),
      utils.getUtxo(redeemTxid, redeemTx, 1),
      fundingPrivateKey
    )
    const redeemTxid2 = await broadcast(redeemHex2)
    console.log(`Redeem TX2:       ${redeemTxid2}`)
    expect(await utils.getVoutAmount(redeemTxid2, 0)).to.equal(0.00000001)
    await utils.isTokenBalance(aliceAddr, 1)
    await utils.isTokenBalance(bobAddr, 0)
  })
})