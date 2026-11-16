const { expect } = require("chai");
const { ethers } = require("hardhat");

const ref = (id) => ethers.keccak256(ethers.toUtf8Bytes(id));
const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s)); // stands in for the SHA-256 of a PDF

describe("AgreementRegistry", () => {
  let registry, admin, outsider;
  beforeEach(async () => {
    [admin, outsider] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("AgreementRegistry")).deploy(admin.address);
  });

  it("registers version 1 and finds it by hash", async () => {
    await expect(registry.register(ref("AGL-1"), h("pdf-v1"), 1)).to.emit(registry, "AgreementRegistered");
    const rec = await registry.latest(ref("AGL-1"));
    expect(rec.docHash).to.equal(h("pdf-v1"));
    expect(rec.version).to.equal(1n);
    expect(rec.prevDocHash).to.equal(ethers.ZeroHash);
    const [agreementRef, version] = await registry.lookup(h("pdf-v1"));
    expect(agreementRef).to.equal(ref("AGL-1"));
    expect(version).to.equal(1n);
    expect(await registry.isLatest(ref("AGL-1"), h("pdf-v1"))).to.equal(true);
  });

  it("chains amendments and never overwrites a version", async () => {
    await registry.register(ref("AGL-1"), h("v1"), 1);
    await registry.register(ref("AGL-1"), h("v2"), 2);
    const v2 = await registry.getVersion(ref("AGL-1"), 2);
    expect(v2.prevDocHash).to.equal(h("v1"));
    expect((await registry.getVersion(ref("AGL-1"), 1)).docHash).to.equal(h("v1")); // original preserved
    await expect(registry.register(ref("AGL-1"), h("v2-again"), 2)).to.be.revertedWithCustomError(registry, "WrongVersion");
    await expect(registry.register(ref("AGL-1"), h("skip"), 4)).to.be.revertedWithCustomError(registry, "WrongVersion");
    expect(await registry.isLatest(ref("AGL-1"), h("v1"))).to.equal(false);
  });

  it("rejects a hash registered twice, zero hashes and unknown lookups", async () => {
    await registry.register(ref("AGL-1"), h("same"), 1);
    await expect(registry.register(ref("AGL-2"), h("same"), 1)).to.be.revertedWithCustomError(registry, "HashAlreadyRegistered");
    await expect(registry.register(ref("AGL-3"), ethers.ZeroHash, 1)).to.be.revertedWithCustomError(registry, "ZeroHash");
    const [, version] = await registry.lookup(h("never"));
    expect(version).to.equal(0n);
    await expect(registry.latest(ref("nope"))).to.be.revertedWithCustomError(registry, "UnknownAgreement");
  });

  it("only registrars can write; admin can pause", async () => {
    await expect(registry.connect(outsider).register(ref("AGL-1"), h("x"), 1))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await registry.pause();
    await expect(registry.register(ref("AGL-1"), h("x"), 1)).to.be.revertedWithCustomError(registry, "EnforcedPause");
    await registry.unpause();
    await registry.register(ref("AGL-1"), h("x"), 1);
  });
});
