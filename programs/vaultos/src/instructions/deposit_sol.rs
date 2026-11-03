use crate::errors::VaultOSError;
use crate::events::DepositReceived;
use crate::state::Vault;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};

#[derive(Accounts)]
#[instruction(amount_lamports: u64)]
pub struct DepositSol<'info> {
    pub vault: Account<'info, Vault>,

    /// CHECK: Validated against vault seeds
    #[account(
        mut,
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump = vault.authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositSol>, amount_lamports: u64) -> Result<()> {
    require!(amount_lamports > 0, VaultOSError::ArithmeticOverflow);
    let clock = Clock::get()?;

    let ix = system_instruction::transfer(
        ctx.accounts.depositor.key,
        ctx.accounts.vault_authority.key,
        amount_lamports,
    );

    invoke(
        &ix,
        &[
            ctx.accounts.depositor.to_account_info(),
            ctx.accounts.vault_authority.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;

    emit!(DepositReceived {
        vault: ctx.accounts.vault.key(),
        depositor: ctx.accounts.depositor.key(),
        mint: None,
        amount: amount_lamports,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
