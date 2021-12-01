const expect = require('chai').expect
const assert = require('chai').assert
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
    getTransaction,
    getFundsFromFaucet,
    broadcast,
    SATS_PER_BITCOIN
} = require('../../index').utils


describe('regression, testnet', function () {

    it('Incorrect Token Id Does Not Issue A Token', async function () {
        const issuerPrivateKey = bsv.PrivateKey()
        const fundingPrivateKey = bsv.PrivateKey()

        const alicePrivateKey = bsv.PrivateKey()
        const aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()

        const bobPrivateKey = bsv.PrivateKey()
        const bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()

        const contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
        const fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())

        // wrong private key supplied to hash for token id and redemption address
        const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(bobPrivateKey.publicKey.toBuffer()).toString('hex')  
        const supply = 10000
        const symbol = 'TAALT'
        const schema = utils.schema(publicKeyHash, symbol, supply)

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
            utils.getIssueInfo(aliceAddr, 7000, bobAddr, 3000),
            utils.getUtxo(contractTxid, contractTx, 0),
            utils.getUtxo(contractTxid, contractTx, 1),
            fundingPrivateKey,
            true,
            symbol,
            2
        )
        const issueTxid = await broadcast(issueHex)
        const tokenId = await utils.getToken(issueTxid)
        console.log(`Token ID:        ${tokenId}`)
        response = await utils.getTokenResponse(tokenId)
        expect(response).to.equal('Token Not Found')
    })
})